import { RequestValidationError, readJsonObject } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';

export const turnstileActions = new Map([
  ['/api/entries', 'entry'],
  ['/api/admin/login', 'admin_login'],
  ['/api/door/login', 'volunteer_login']
]);

export function turnstileReady(env) {
  return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.TURNSTILE_HOSTNAMES);
}

export async function verifyTurnstile(request, env, token, action, fetchTarget) {
  const unavailable = () => new RequestValidationError('Security verification is unavailable. Please try again in a moment.', 'turnstile_unavailable', 503);
  const invalid = () => new RequestValidationError('Complete the security check and try again.', 'turnstile_failed', 400);
  if (!turnstileReady(env)) throw unavailable();
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw invalid();
  let result;
  try {
    const response = await fetchTarget.call(globalThis, 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token,
        remoteip: request.headers.get('cf-connecting-ip') || undefined })
    });
    if (!response.ok) throw unavailable();
    result = await readJsonObject(response, 8192);
  } catch { throw unavailable(); }
  if (result['error-codes']?.some?.(code => ['internal-error', 'missing-input-secret', 'invalid-input-secret'].includes(code))) throw unavailable();
  const hostnames = env.TURNSTILE_HOSTNAMES.split(',').map(value => value.trim()).filter(Boolean);
  if (result.success !== true || result.action !== action || !hostnames.includes(result.hostname)) throw invalid();
}
