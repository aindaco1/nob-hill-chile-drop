import { normalizeEmail, sha256Hex } from '../../shared/dust-wave-platform/packages/worker-core/src/crypto.js';
import { RequestValidationError } from '../../shared/dust-wave-platform/packages/worker-core/src/request-validation.js';

const emails = value => [...new Set(String(value || '').split(',').map(normalizeEmail).filter(Boolean))];
export const superAdmins = env => emails(env.SUPER_ADMIN_EMAILS);
export const configuredAdmins = env => [...new Set([...superAdmins(env), ...emails(env.ADMIN_EMAILS)])];
export const configuredAdmin = (env, email) => configuredAdmins(env).includes(email);
export async function adminRole(env, email) {
  if (superAdmins(env).includes(email)) return 'super_admin';
  if (configuredAdmin(env, email)) return 'admin';
  return await env.DB.prepare('SELECT 1 FROM admin_access WHERE email=? AND active=1').bind(email).first() ? 'admin' : null;
}
export async function adminIdentity(env, email) {
  const role = await adminRole(env, email);
  return { email, role, canManageAdmins: role === 'super_admin' };
}

export function createAdminAccess({ bodyOf, normalizedEmail, audit }) {
  function requireSuper(env, actor) {
    if (!superAdmins(env).includes(actor)) throw new RequestValidationError('Only a super admin can manage organizer access.', 'admin_access_forbidden', 403);
  }
  async function list(env, actor) {
    requireSuper(env, actor);
    const rows = await env.DB.prepare('SELECT email FROM admin_access WHERE active=1 ORDER BY email').all();
    const all = [...new Set([...configuredAdmins(env), ...rows.results.map(row => row.email)])].sort();
    return { admins: all.map(email => ({ email, role: superAdmins(env).includes(email) ? 'super_admin' : 'admin', protected: configuredAdmin(env, email) })) };
  }
  async function update(request, env, actor, now) {
    requireSuper(env, actor);
    const body = await bodyOf(request);
    const email = normalizedEmail(body.email);
    if (typeof body.active !== 'boolean' || Object.keys(body).some(key => !['email','active'].includes(key))) {
      throw new RequestValidationError('Provide an email and whether admin access is active.', 'invalid_request', 400);
    }
    if (configuredAdmin(env, email)) throw new RequestValidationError('This organizer has protected access and cannot be changed here.', 'protected_admin', 409);
    const statements = [env.DB.prepare('INSERT INTO admin_access(email,active,updated_at) VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET active=excluded.active,updated_at=excluded.updated_at').bind(email, Number(body.active), now)];
    if (!body.active) {
      statements.push(env.DB.prepare("DELETE FROM tokens WHERE subject=? AND kind IN ('admin_link','admin_session')").bind(email));
      statements.push(env.DB.prepare('DELETE FROM door_tokens WHERE email=?').bind(email));
    }
    statements.push(audit(env, 'admin_access_updated', actor, now, { active: body.active, adminHash: await sha256Hex(email) }));
    await env.DB.batch(statements);
    return list(env, actor);
  }
  return { list, update };
}
