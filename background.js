const DEFAULTS = { enabled: true, allowlist: [] };
const ALLOWLIST_RULE_ID = 1;

// Show the number of blocked requests on the toolbar icon, per tab.
chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });

async function applySettings() {
  const { enabled, allowlist } = await chrome.storage.local.get(DEFAULTS);

  // Network blocking (static ruleset from rules/ads.json).
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    enabled ? { enableRulesetIds: ['ads'] } : { disableRulesetIds: ['ads'] }
  );

  // Allowlisted sites: allow every request made by pages of these domains.
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldRules.map((r) => r.id),
    addRules: allowlist.length
      ? [{
          id: ALLOWLIST_RULE_ID,
          priority: 100,
          action: { type: 'allowAllRequests' },
          condition: { requestDomains: allowlist, resourceTypes: ['main_frame', 'sub_frame'] }
        }]
      : []
  });

  // Content scripts are registered dynamically so they respect the on/off switch and the allowlist.
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) {
    await chrome.scripting.unregisterContentScripts({ ids: registered.map((s) => s.id) });
  }
  if (!enabled) return;

  const exclude = allowlist.length ? { excludeMatches: allowlist.map((h) => `*://*.${h}/*`) } : {};
  const youtube = ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'];

  await chrome.scripting.registerContentScripts([
    {
      id: 'cosmetic',
      matches: ['<all_urls>'],
      css: ['content/cosmetic.css'],
      runAt: 'document_start',
      allFrames: true,
      ...exclude
    },
    {
      id: 'yt-main',
      matches: youtube,
      js: ['content/yt-main.js'],
      world: 'MAIN',
      runAt: 'document_start',
      allFrames: true,
      ...exclude
    },
    {
      id: 'yt-skip',
      matches: youtube,
      js: ['content/yt-skip.js'],
      runAt: 'document_start',
      allFrames: true,
      ...exclude
    }
  ]);
}

// Serialize updates so rapid toggles can't register the same script id twice.
let queue = Promise.resolve();
function sync() {
  queue = queue.then(applySettings).catch((err) => console.error('BlockAds:', err));
  return queue;
}

chrome.runtime.onInstalled.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('enabled' in changes || 'allowlist' in changes)) sync();
  if (area === 'session' && 'loggingTabs' in changes) {
    loggingTabs = new Set(changes.loggingTabs.newValue ?? []);
  }
});

// ---- Request log: records every request of chosen tabs to find new ad sources ----

const LOG_LIMIT = 3000;
let loggingTabs = null; // Set of tab ids, loaded lazily (the worker can be restarted any time)
const pendingLog = new Map(); // tabId -> entries not yet written to storage
let flushTimer = null;

async function isLogging(tabId) {
  if (!loggingTabs) {
    const { loggingTabs: ids = [] } = await chrome.storage.session.get('loggingTabs');
    loggingTabs = new Set(ids);
  }
  return loggingTabs.has(tabId);
}

async function record(details, result) {
  if (details.tabId < 0 || !(await isLogging(details.tabId))) return;
  const entry = {
    type: details.type,
    result,
    url: details.url.slice(0, 400),
    initiator: details.initiator ?? ''
  };
  if (!pendingLog.has(details.tabId)) pendingLog.set(details.tabId, []);
  pendingLog.get(details.tabId).push(entry);
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flushing = flushing.then(flushLog).catch((err) => console.error('BlockAds log:', err));
  }, 1000);
}

// Writes are chained so two flushes never read-modify-write the same key at once.
let flushing = Promise.resolve();
async function flushLog() {
  const batches = [...pendingLog];
  pendingLog.clear();
  for (const [tabId, entries] of batches) {
    const key = `log:${tabId}`;
    const { [key]: old = [] } = await chrome.storage.session.get(key);
    await chrome.storage.session.set({ [key]: old.concat(entries).slice(0, LOG_LIMIT) });
  }
}

const ALL_URLS = { urls: ['<all_urls>'] };
chrome.webRequest.onCompleted.addListener((d) => record(d, String(d.statusCode)), ALL_URLS);
chrome.webRequest.onBeforeRedirect.addListener((d) => record(d, `${d.statusCode} -> ${d.redirectUrl.slice(0, 200)}`), ALL_URLS);
chrome.webRequest.onErrorOccurred.addListener(
  (d) => record(d, d.error === 'net::ERR_BLOCKED_BY_CLIENT' ? 'BLOCKED' : d.error),
  ALL_URLS
);

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!(await isLogging(tabId))) return;
  await chrome.storage.session.set({ loggingTabs: [...loggingTabs].filter((id) => id !== tabId) });
  await chrome.storage.session.remove(`log:${tabId}`);
});
