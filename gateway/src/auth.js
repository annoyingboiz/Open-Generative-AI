// Users and sessions. Accounts are created by an admin; there is no open sign-up.
import { hashPassword, verifyPassword, verifyPasswordAsync, newToken, sha256, MAX_PASSWORD_LENGTH } from './crypto.js';
import { now } from './db.js';

export const SESSION_COOKIE = 'dz_session';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;

export function createAuth({ db, sessionDays }) {
  const q = {
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    byUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    byId: db.prepare('SELECT * FROM users WHERE id = ?'),
    list: db.prepare('SELECT id, username, display_name, role, monthly_limit_usd, disabled, created_at FROM users WHERE deleted_at IS NULL ORDER BY id'),
    // The owner: the first account, made at setup. It cannot be deleted, blocked or lose admin.
    owner: db.prepare('SELECT MIN(id) AS id FROM users'),
    softDelete: db.prepare('UPDATE users SET username = ?, disabled = 1, deleted_at = ? WHERE id = ?'),
    // Their projects go to the owner of this server (nothing is left without an owner); they leave the rest.
    takeProjects: db.prepare('UPDATE projects SET owner_id = ? WHERE owner_id = ?'),
    ownProjects: db.prepare('SELECT id FROM projects WHERE owner_id = ?'),
    makeOwner: db.prepare(`INSERT INTO project_members (project_id, user_id, role, added_at, last_used_at) VALUES (?, ?, 'owner', ?, NULL)
      ON CONFLICT(project_id, user_id) DO UPDATE SET role = 'owner'`),
    leaveProjects: db.prepare('DELETE FROM project_members WHERE user_id = ?'),
    insert: db.prepare('INSERT INTO users (username, display_name, pw_hash, role, monthly_limit_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setPassword: db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?'),
    update: db.prepare('UPDATE users SET display_name = ?, role = ?, monthly_limit_usd = ?, disabled = ? WHERE id = ?'),
    countActiveAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0"),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0
    `),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  const hasUsers = () => q.countUsers.get().n > 0;

  function validateNewUser({ username, displayName, password }) {
    if (!USERNAME_RE.test(username || '')) return 'Login: 2–32 characters, letters, digits, dot, dash or underscore.';
    if (q.byUsername.get(username)) return 'This login is already taken.';
    if (!displayName?.trim()) return 'Name is required.';
    return validatePassword(password);
  }

  function validatePassword(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters.';
    if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.';
    return null;
  }

  function createUser({ username, displayName, password, role = 'user', monthlyLimitUsd = null }) {
    const error = validateNewUser({ username, displayName, password });
    if (error) throw new UserError(error);
    const info = q.insert.run(username.trim(), displayName.trim(), hashPassword(password), role, monthlyLimitUsd, now());
    return q.byId.get(Number(info.lastInsertRowid));
  }

  function startSession(user, userAgent) {
    const token = newToken();
    const t = now();
    q.insertSession.run(sha256(token), user.id, t, t + sessionDays * 86_400_000, String(userAgent || '').slice(0, 200));
    if (Math.random() < 0.05) q.purgeSessions.run(t);
    return { token, user };
  }

  async function login(username, password, userAgent) {
    const user = q.byUsername.get(String(username || '').trim().slice(0, 64));
    // Hash even when the user doesn't exist, so timing doesn't reveal logins.
    const ok = user ? await verifyPasswordAsync(String(password || ''), user.pw_hash) : (await verifyPasswordAsync('x', DUMMY_HASH), false);
    if (!ok || user.disabled) return null;
    return startSession(user, userAgent);
  }

  function userFromToken(token) {
    if (!token) return null;
    return q.sessionUser.get(sha256(token), now()) || null;
  }

  function logout(token) {
    if (token) q.deleteSession.run(sha256(token));
  }

  // Ends every session of the user. With newSession, returns a fresh one
  // (a new token — the old cookie stops working) so the user stays signed in.
  function changePassword(userId, password, { newSession = false, userAgent } = {}) {
    const error = validatePassword(password);
    if (error) throw new UserError(error);
    q.setPassword.run(hashPassword(password), userId);
    q.deleteUserSessions.run(userId);
    return newSession ? startSession(q.byId.get(userId), userAgent) : null;
  }

  async function checkPassword(userId, password) {
    const user = q.byId.get(userId);
    return Boolean(user && await verifyPasswordAsync(String(password || ''), user.pw_hash));
  }

  const ownerId = () => q.owner.get()?.id ?? null;

  function updateUser(id, { displayName, role, monthlyLimitUsd, disabled }) {
    const user = q.byId.get(id);
    if (!user || user.deleted_at) throw new UserError('User not found.');
    const nextRole = role === 'admin' ? 'admin' : 'user';
    const nextDisabled = disabled ? 1 : 0;
    if (id === ownerId() && (nextRole !== 'admin' || nextDisabled)) throw new UserError('The owner of this server stays an active admin.');
    const losesAdmin = user.role === 'admin' && !user.disabled && (nextRole !== 'admin' || nextDisabled);
    if (losesAdmin && q.countActiveAdmins.get().n <= 1) {
      throw new UserError('At least one active admin must remain.');
    }
    q.update.run(displayName?.trim() || user.display_name, nextRole, monthlyLimitUsd, nextDisabled, id);
    if (nextDisabled) q.deleteUserSessions.run(id);
  }

  // Soft delete: signed out everywhere, cannot sign in, gone from the lists; the login is freed
  // (renamed) so it can be used again. Their work and spending stay.
  function deleteUser(id) {
    const user = q.byId.get(id);
    if (!user || user.deleted_at) throw new UserError('User not found.');
    if (id === ownerId()) throw new UserError('The owner of this server cannot be deleted.');
    if (user.role === 'admin' && !user.disabled && q.countActiveAdmins.get().n <= 1) throw new UserError('At least one active admin must remain.');
    const owner = ownerId();
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const p of q.ownProjects.all(id)) q.makeOwner.run(p.id, owner, now());
      q.takeProjects.run(owner, id);
      q.leaveProjects.run(id);
      q.softDelete.run(`${user.username}~deleted-${id}`, now(), id);
      q.deleteUserSessions.run(id);
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch { /* closed */ } throw error; }
  }

  return {
    hasUsers, createUser, login, logout, startSession, userFromToken, changePassword, checkPassword, updateUser, deleteUser, ownerId, validatePassword,
    listUsers: () => q.list.all(),
    getUser: (id) => q.byId.get(id),
  };
}

const DUMMY_HASH = hashPassword('dummy-password-for-timing');
void verifyPassword;

export class UserError extends Error {}

export const publicUser = (u) => u && ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  monthlyLimitUsd: u.monthly_limit_usd,
});

// In-memory throttle for login attempts: 10 failures per 15 minutes, counted
// separately per IP and per login name. A success clears only that login's
// counter, so signing in to one's own account doesn't reset guesses on others.
export function createLoginThrottle({ max = 10, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return {
    blocked(ip) {
      const h = hits.get(ip);
      if (!h) return false;
      if (Date.now() - h.first > windowMs) { hits.delete(ip); return false; }
      return h.count >= max;
    },
    fail(ip) {
      const h = hits.get(ip);
      if (!h || Date.now() - h.first > windowMs) hits.set(ip, { first: Date.now(), count: 1 });
      else h.count += 1;
    },
    reset(ip) { hits.delete(ip); },
  };
}
