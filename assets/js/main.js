(() => {
  'use strict';
  const clock = document.querySelector('[data-countdown]');
  if (clock) {
    const target = Date.parse(clock.dataset.countdown);
    const units = { days: 86400, hours: 3600, minutes: 60, seconds: 1 };
    let timer;
    const tick = () => {
      let remaining = Math.max(0, Math.floor((target - Date.now()) / 1000));
      if (!Number.isFinite(remaining)) return;
      for (const [unit, divisor] of Object.entries(units)) {
        const element = clock.querySelector(`[data-time="${unit}"]`);
        if (element) element.textContent = String(Math.floor(remaining / divisor)).padStart(2, '0');
        remaining %= divisor;
      }
      if (Date.now() >= target) {
        document.getElementById('countdown-title').textContent = 'Happy New Year, Albuquerque!';
        clearInterval(timer);
      }
    };
    tick();
    if (target > Date.now()) timer = setInterval(tick, 1000);
    document.addEventListener('visibilitychange', () => {
      clearInterval(timer);
      if (!document.hidden) { tick(); if (target > Date.now()) timer = setInterval(tick, 1000); }
    });
  }
  // Adapted from ZEMA's click-to-play facade. No third-party request before intent.
  document.querySelectorAll('[data-youtube-id]').forEach(player => {
    player.querySelector('[data-youtube-play]')?.addEventListener('click', () => {
      if (!/^[A-Za-z0-9_-]{11}$/.test(player.dataset.youtubeId)) return;
      const frame = document.createElement('iframe');
      frame.src = `https://www.youtube-nocookie.com/embed/${player.dataset.youtubeId}?autoplay=1&rel=0`;
      frame.title = player.dataset.youtubeTitle;
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      frame.allowFullscreen = true;
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      player.replaceChildren(frame);
      frame.focus();
    }, { once: true });
  });
})();
