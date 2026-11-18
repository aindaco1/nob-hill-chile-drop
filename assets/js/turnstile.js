import { request } from './api.js';

let scriptPromise;
function loadScript() {
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => fail(), 15000);
    function fail() {
      clearTimeout(timer); script.remove(); scriptPromise = undefined;
      reject(new Error('The security check could not load. Check your connection and retry.'));
    }
    window.chileDropTurnstileReady = () => { clearTimeout(timer); resolve(window.turnstile); };
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=chileDropTurnstileReady';
    script.async = true; script.onerror = fail;
    document.head.append(script);
  });
  return scriptPromise;
}

// Call only on public entry or an anonymous sign-in screen, after clearing URL credentials.
export function setupTurnstile(form, action) {
  const wrapper = form.querySelector('[data-security-check]');
  const container = wrapper.querySelector('[data-turnstile-widget]');
  const feedback = wrapper.querySelector('[data-turnstile-status]');
  const retry = wrapper.querySelector('[data-turnstile-retry]');
  let api, widget, sitekey, token = '', size, starting = false, active = false;
  const say = text => { feedback.textContent = text; };
  const pending = () => { token = ''; say('Complete the security check before submitting.'); };
  const failed = () => { token = ''; say('The security check could not finish. Please retry.'); retry.hidden = false; return true; };
  function render() {
    if (!active || !api || !sitekey || !container.getBoundingClientRect().width) return;
    const next = container.getBoundingClientRect().width < 300 ? 'compact' : 'flexible';
    if (widget !== undefined && size === next) return;
    if (widget !== undefined) api.remove(widget);
    size = next; wrapper.dataset.size = size; pending(); retry.hidden = true;
    widget = api.render(container, {
      sitekey, action, theme: 'dark', size, 'response-field': false,
      callback: value => { token = value; say('Security check complete.'); retry.hidden = true; },
      'expired-callback': pending, 'timeout-callback': failed, 'error-callback': failed,
      'refresh-expired': 'auto'
    });
  }
  const observer = new ResizeObserver(() => { try { render(); } catch { failed(); } });
  async function start(config) {
    if (starting || active) return;
    starting = true; retry.hidden = true; say('Loading security check…');
    try {
      config ||= await request('/api/config');
      if (!config.turnstileSiteKey) throw new Error('Security verification is unavailable. Please retry in a moment.');
      sitekey = config.turnstileSiteKey;
      api = await loadScript(); active = true;
      observer.observe(container); render();
    } catch (error) { active = false; say(error.message); retry.hidden = false; }
    finally { starting = false; }
  }
  function reset() {
    token = '';
    if (widget !== undefined) { pending(); retry.hidden = true; try { api.reset(widget); } catch { failed(); } }
  }
  retry.addEventListener('click', () => { if (widget !== undefined) reset(); else start(); });
  return {
    start, reset,
    token() {
      if (!token || (widget !== undefined && api.isExpired(widget))) {
        token = ''; wrapper.scrollIntoView({ block: 'center', behavior: 'auto' });
        throw new Error('Complete the security check before submitting.');
      }
      return token;
    }
  };
}
