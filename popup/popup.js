const enabledBox = document.getElementById('enabled');
const siteBox = document.getElementById('site');
const siteRow = document.getElementById('site-row');
const hostEl = document.getElementById('host');
const reloadHint = document.getElementById('reload-hint');

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const host = siteHost(tab?.url);
let { enabled, allowlist } = await chrome.storage.local.get({ enabled: true, allowlist: [] });

function siteHost(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const h = u.hostname.replace(/^www\./, '');
    return /^[a-z0-9.-]+$/i.test(h) ? h.toLowerCase() : null;
  } catch {
    return null;
  }
}

function render() {
  enabledBox.checked = enabled;
  hostEl.textContent = host ?? 'этой странице';
  siteBox.checked = host ? !allowlist.includes(host) : false;
  siteRow.classList.toggle('disabled', !enabled || !host);
}

async function save(changes) {
  await chrome.storage.local.set(changes);
  if (tab?.id !== undefined) {
    // Give the background worker a moment to apply the new rules, then reload.
    setTimeout(() => chrome.tabs.reload(tab.id), 300);
    reloadHint.hidden = false;
  }
}

enabledBox.addEventListener('change', () => {
  enabled = enabledBox.checked;
  render();
  save({ enabled });
});

siteBox.addEventListener('change', () => {
  allowlist = siteBox.checked
    ? allowlist.filter((h) => h !== host)
    : [...new Set([...allowlist, host])];
  render();
  save({ allowlist });
});

render();

// ---- Request log ----

const logToggle = document.getElementById('log-toggle');
const logCopy = document.getElementById('log-copy');
const logStatus = document.getElementById('log-status');
const logKey = `log:${tab?.id}`;
let statusNote = null;

async function logState() {
  const { loggingTabs = [], [logKey]: entries = [] } = await chrome.storage.session.get(['loggingTabs', logKey]);
  return { loggingTabs, entries, active: loggingTabs.includes(tab?.id) };
}

async function renderLog() {
  const { entries, active } = await logState();
  logToggle.textContent = active ? 'Остановить запись' : 'Начать запись';
  logToggle.disabled = tab?.id === undefined;
  logCopy.disabled = entries.length === 0;
  logStatus.textContent = statusNote ?? (entries.length || active ? `Записано запросов: ${entries.length}` : '');
}

function formatLog(entries) {
  const hosts = new Map();
  for (const e of entries) {
    let h;
    try { h = new URL(e.url).hostname; } catch { h = e.url.slice(0, 40); }
    const s = hosts.get(h) ?? { count: 0, blocked: 0, types: new Set() };
    s.count++;
    if (e.result === 'BLOCKED') s.blocked++;
    s.types.add(e.type);
    hosts.set(h, s);
  }
  const hostLines = [...hosts]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([h, s]) => `${String(s.count).padStart(5)}  ${h}  [${[...s.types].join(', ')}]${s.blocked ? `  заблокировано: ${s.blocked}` : ''}`);
  const requestLines = entries.map((e) => `${e.type}\t${e.result}\t${e.url}\t(от ${e.initiator || '-'})`);
  return [
    'BlockAds — журнал запросов',
    `Страница: ${tab?.url}`,
    `Запросов: ${entries.length}`,
    '',
    '== Домены ==',
    ...hostLines,
    '',
    '== Запросы ==',
    ...requestLines
  ].join('\n');
}

logToggle.addEventListener('click', async () => {
  const { loggingTabs, active } = await logState();
  if (active) {
    await chrome.storage.session.set({ loggingTabs: loggingTabs.filter((id) => id !== tab.id) });
  } else {
    // Start from a clean log and reload, so the whole page load is captured.
    await chrome.storage.session.set({ loggingTabs: [...loggingTabs, tab.id], [logKey]: [] });
    chrome.tabs.reload(tab.id);
  }
  renderLog();
});

logCopy.addEventListener('click', async () => {
  const { entries } = await logState();
  await navigator.clipboard.writeText(formatLog(entries));
  statusNote = `Скопировано запросов: ${entries.length}. Вставьте журнал в чат.`;
  setTimeout(() => { statusNote = null; }, 5000);
  renderLog();
});

renderLog();
setInterval(renderLog, 1000);
