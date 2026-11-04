// Called with public configuration; only the fixed, site-authored embed can load.
export function renderHeroMedia(mode) {
  const hero = document.querySelector('.hero');
  const stream = document.querySelector('[data-hero-stream]');
  const art = document.querySelector('.hero__art');
  if (!hero || !stream || !art) return;
  const enabled = mode === 'channel26';
  if (hero.classList.contains('hero--stream') === enabled) return;
  const player = stream.querySelector('[data-stream-player]');
  const focusWasInside = (enabled ? art : stream).contains(document.activeElement);
  if (enabled) {
    const frame = document.createElement('iframe');
    frame.src = player.dataset.streamUrl;
    frame.title = player.dataset.streamTitle;
    frame.width = '360';
    frame.height = '240';
    frame.allow = 'fullscreen; picture-in-picture';
    frame.allowFullscreen = true;
    frame.referrerPolicy = 'no-referrer';
    player.replaceChildren(frame);
  } else {
    // Remove the player so its network/audio stops when organizers restore the art.
    player.replaceChildren();
  }
  art.hidden = enabled;
  stream.hidden = !enabled;
  hero.classList.toggle('hero--stream', enabled);
  // A live switch must not leave keyboard focus in hidden or removed content.
  if (focusWasInside) hero.querySelector('h1').focus({ preventScroll: true });
}
