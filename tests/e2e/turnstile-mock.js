// Deterministic provider stand-in. Real Cloudflare rendering is checked separately.
export async function mockTurnstile(page, { autoSolve = true, blocked = false } = {}) {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js?*', async route => {
    if (blocked) return route.abort();
    await route.fulfill({ contentType: 'application/javascript', body: `
      (() => {
        let sequence = 0;
        const widgets = new Map();
        const solve = id => { const w = widgets.get(id); w.expired = false; w.options.callback('test:' + w.options.action + ':' + crypto.randomUUID()); };
        window.__turnstileTest = { widgets, solve,
          expire(id) { widgets.get(id).expired = true; widgets.get(id).options['expired-callback'](); },
          error(id) { widgets.get(id).options['error-callback']('test-error'); }
        };
        window.turnstile = {
          render(container, options) {
            const id = String(++sequence);
            const frame = document.createElement('iframe'); frame.title = 'Cloudflare security challenge (test)';
            frame.style.cssText = 'display:block;border:0;width:' + (options.size === 'compact' ? '150px;height:140px' : '100%;min-width:300px;height:65px');
            frame.srcdoc = '<html lang="en"><title>Security check</title><body style="background:#232323;color:white;font:14px sans-serif;margin:0;padding:12px"><button type="button">Verify you are human</button><p>Cloudflare · Test widget</p></body></html>';
            frame.addEventListener('load', () => frame.contentDocument.querySelector('button').onclick = () => solve(id));
            container.append(frame); widgets.set(id, { frame, options, expired: false });
            if (${autoSolve}) queueMicrotask(() => solve(id));
            return id;
          },
          reset(id) { const w = widgets.get(id); w.expired = false; if (${autoSolve}) queueMicrotask(() => solve(id)); },
          remove(id) { widgets.get(id).frame.remove(); widgets.delete(id); },
          isExpired(id) { return widgets.get(id).expired; }
        };
        window.chileDropTurnstileReady();
      })();` });
  });
}
