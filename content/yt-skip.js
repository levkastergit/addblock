// Fallback for ads that still reach the player: click "Skip", or mute and jump to the end.
(() => {
  'use strict';

  const SKIP_BUTTONS = '.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern';
  const OVERLAY_CLOSE = '.ytp-ad-overlay-close-button';
  const mutedByUs = new WeakSet();

  function check() {
    for (const player of document.querySelectorAll('.html5-video-player')) {
      const video = player.querySelector('video');
      if (player.classList.contains('ad-showing')) {
        player.querySelector(SKIP_BUTTONS)?.click();
        if (video) {
          if (!video.muted) {
            video.muted = true;
            mutedByUs.add(video);
          }
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        }
      } else if (video && mutedByUs.has(video)) {
        video.muted = false;
        mutedByUs.delete(video);
      }
    }
    document.querySelectorAll(OVERLAY_CLOSE).forEach((b) => b.click());
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      check();
    });
  }

  new MutationObserver(schedule).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class']
  });
  setInterval(check, 500);
})();
