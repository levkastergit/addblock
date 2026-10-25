// Runs in the page's own JS context (world: MAIN) before YouTube's scripts.
// Removes ad data from player responses so the player has no ads to show.
(() => {
  'use strict';

  const AD_KEYS = ['adPlacements', 'adSlots', 'playerAds'];

  function pruneOne(obj) {
    for (const key of AD_KEYS) {
      if (key in obj) delete obj[key];
    }
    if (obj.playerResponse && typeof obj.playerResponse === 'object') pruneOne(obj.playerResponse);
  }

  function prune(value) {
    if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const item of value) if (item && typeof item === 'object') pruneOne(item);
      } else {
        pruneOne(value);
      }
    }
    return value;
  }

  // Responses parsed via JSON.parse (XHR, response.text() + JSON.parse, embedded JSON).
  const nativeParse = JSON.parse;
  JSON.parse = function parse(...args) {
    return prune(nativeParse.apply(this, args));
  };

  // Responses parsed via fetch(...).then(r => r.json()).
  const nativeJson = Response.prototype.json;
  Response.prototype.json = function json(...args) {
    return nativeJson.apply(this, args).then(prune);
  };

  // Initial page data: `var ytInitialPlayerResponse = {...}` assigns through this setter.
  let initialPlayerResponse;
  Object.defineProperty(window, 'ytInitialPlayerResponse', {
    configurable: true,
    get: () => initialPlayerResponse,
    set: (v) => { initialPlayerResponse = prune(v); }
  });
})();
