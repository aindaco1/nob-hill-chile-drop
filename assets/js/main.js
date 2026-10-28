(() => {
  'use strict';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const scene = document.querySelector('[data-drop-scene]');
  const replay = document.querySelector('[data-drop-replay]');
  if (scene && replay) {
    const finishDrop = () => { scene.classList.remove('is-dropping'); replay.disabled = false; };
    const drop = () => {
      if (reducedMotion.matches) return;
      replay.disabled = true;
      scene.classList.add('is-dropping');
    };
    scene.addEventListener('animationend', finishDrop);
    replay.hidden = false;
    replay.addEventListener('click', drop);
    reducedMotion.addEventListener('change', finishDrop);
    // On narrow screens, wait until the illustration is in view.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { drop(); observer.disconnect(); }
    }, { threshold: .35 });
    observer.observe(scene);
  }

  const cursorMode = matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)');
  let cursor, cursorPosition, cursorLoading, idleTimer;
  const hideCursor = () => {
    document.documentElement.classList.remove('has-chile-cursor');
    cursor?.classList.remove('is-moving');
    clearTimeout(idleTimer);
  };
  const prepareCursor = async () => {
    if (!cursorMode.matches || cursor || cursorLoading) return;
    cursorLoading = true;
    try {
      let artwork = scene?.querySelector('svg');
      if (!artwork) {
        const response = await fetch(document.body.dataset.chileArt);
        if (!response.ok) return;
        artwork = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
      }
      const defs = artwork.querySelector('defs');
      const body = artwork.querySelector('#chile-body');
      if (!defs || !body) return;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '80 100 380 520');
      svg.setAttribute('fill', 'none');
      svg.append(defs.cloneNode(true), body.cloneNode(true));
      // Share the original geometry while keeping inline SVG IDs unique.
      for (const node of svg.querySelectorAll('*')) {
        for (const attribute of Array.from(node.attributes)) {
          let value = attribute.value.replace(/url\(#([^)]*)\)/g, 'url(#cursor-$1)');
          if (attribute.name === 'id') value = `cursor-${value}`;
          if (attribute.name === 'href' && value.startsWith('#')) value = `#cursor-${value.slice(1)}`;
          node.setAttribute(attribute.name, value);
        }
      }
      cursor = document.createElement('div');
      cursor.className = 'chile-cursor';
      cursor.setAttribute('aria-hidden', 'true');
      cursorPosition = document.createElement('span');
      cursorPosition.className = 'chile-cursor__position';
      cursorPosition.append(svg);
      cursor.append(cursorPosition);
      document.body.append(cursor);
    } catch { /* Native cursor remains available if artwork cannot load. */ }
    finally { cursorLoading = false; }
  };
  document.addEventListener('pointermove', event => {
    if (!cursor || !cursorMode.matches || event.pointerType !== 'mouse' || event.target.closest('input,textarea,select,[contenteditable],iframe')) {
      hideCursor(); return;
    }
    cursorPosition.style.transform = `translate3d(${event.clientX - 3}px,${event.clientY - 41}px,0)`;
    document.documentElement.classList.add('has-chile-cursor');
    cursor.classList.add('is-moving');
    clearTimeout(idleTimer);
    // Sway only while moving; a resting pointer does not loop indefinitely.
    idleTimer = setTimeout(() => cursor.classList.remove('is-moving'), 180);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', hideCursor);
  window.addEventListener('blur', hideCursor);
  document.addEventListener('keydown', hideCursor);
  document.addEventListener('scroll', hideCursor, { passive: true, capture: true });
  document.addEventListener('visibilitychange', hideCursor);
  cursorMode.addEventListener('change', () => { hideCursor(); prepareCursor(); });
  prepareCursor();

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
