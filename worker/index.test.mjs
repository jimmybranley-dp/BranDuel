import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from './index';
import { PLAYER_IDS } from '../src/data';

class MemoryD1 {
  sqlite = new DatabaseSync(':memory:');
  failPattern = null;
  loseCommitResponse = false;
  parallelReads = null;
  constructor() {
    this.sqlite.exec(readFileSync(new URL('../migrations/0001_shared_state.sql', import.meta.url), 'utf8'));
    this.sqlite.exec(readFileSync(new URL('../migrations/0002_authoritative_actions.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const db = this;
    let values = [];
    function execute() {
      if (db.failPattern && sql.includes(db.failPattern)) throw new Error('Injected database write failure');
      const statement = db.sqlite.prepare(sql);
      if (statement.columns().length) {
        const results = statement.all(...values);
        return { success: true, results, meta: { changes: Number(db.sqlite.prepare('SELECT changes() AS n').get().n) } };
      }
      const result = statement.run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    }
    return {
      bind(...args) { values = args; return this; },
      execute,
      async first() {
        const row = db.sqlite.prepare(sql).get(...values) ?? null;
        if (db.parallelReads && sql === 'SELECT revision, state_json FROM app_state WHERE id = 1') {
          const barrier = db.parallelReads;
          barrier.count++;
          if (barrier.count === 2) { db.parallelReads = null; barrier.release(); }
          await barrier.promise;
        }
        return row;
      },
      async run() { return execute(); },
      async all() { return execute(); },
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    let results;
    try {
      results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    if (this.loseCommitResponse) { this.loseCommitResponse = false; throw new Error('Injected lost commit acknowledgment'); }
    return results;
  }
  coordinateReads() {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    this.parallelReads = { count: 0, promise, release };
  }
  row(sql) { return this.sqlite.prepare(sql).get(); }
  state() { return JSON.parse(this.row('SELECT state_json FROM app_state').state_json); }
  close() { this.sqlite.close(); }
}
const salt = '0102030405060708090a0b0c0d0e0f10';
const passcode = 'test-secret-only';
const encoded = `pbkdf2$100000$${salt}$${pbkdf2Sync(passcode, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex')}`;
const PLAYER_PASSCODES = JSON.stringify(Object.fromEntries(PLAYER_IDS.map(id => [id, encoded])));
let db;
let cookies;
async function call(path, data, player = 'jimmy', extraHeaders = {}) {
  const response = await worker.fetch(new Request(`https://event.test${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { origin: 'https://event.test', 'content-type': 'application/json', ...(cookies?.[player] ? { cookie: cookies[player] } : {}), ...extraHeaders },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), { DB: db, PLAYER_PASSCODES });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function signIn(player = 'jimmy') {
  const result = await call('/api/login', { playerId: player, passcode }, 'none');
  expect(result.status).toBe(200);
  cookies[player] = result.headers.get('set-cookie').split(';')[0];
  return result;
}
const adjust = (amount = 100_000) => ({ type: 'ADJUST_BALANCE', teamId: 'corey-jimmy', amount, note: 'Verified adjustment' });
async function action(command, requestId = crypto.randomUUID(), player = 'jimmy') { return call('/api/actions', { action: command, requestId, expectedPlayerId: player }, player); }
beforeEach(async () => { db = new MemoryD1(); cookies = {}; await signIn(); await call('/api/state'); });
afterEach(() => db.close());

describe('authoritative Worker authentication', () => {
  it('requires a session and rejects claimed actors/internal hydration without writing', async () => {
    expect((await action(adjust(), undefined, 'none')).status).toBe(401);
    await signIn('jason');
    expect((await call('/api/actions', { requestId: crypto.randomUUID(), actorId: 'jimmy', action: adjust() }, 'jason')).status).toBe(400);
    expect((await action(adjust(), undefined, 'jason')).status).toBe(403);
    expect((await action({ type: 'HYDRATE_REMOTE', state: { balances: { 'corey-jimmy': 123 } } }, undefined, 'jason')).status).toBe(400);
    expect(db.state().balances['corey-jimmy']).toBe(10_000_000);
  });
  it('uses secure HttpOnly cookies, expires sessions, and revokes logout', async () => {
    const login = await signIn();
    expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(login.headers.get('set-cookie')).toContain('; Secure');
    expect((await call('/api/session')).body.playerId).toBe('jimmy');
    db.sqlite.exec('UPDATE player_sessions SET expires_at = 0');
    expect((await call('/api/state')).status).toBe(401);
    await signIn();
    await call('/api/logout', {});
    expect((await call('/api/session')).body.playerId).toBe(null);
  });
  it('rejects cross-origin mutation and throttles passcode guessing', async () => {
    expect((await call('/api/actions', { action: adjust(), requestId: crypto.randomUUID() }, 'jimmy', { origin: 'https://evil.test' })).status).toBe(403);
    for (let i = 0; i < 20; i++) await call('/api/login', { playerId: 'ryan', passcode: 'incorrect' }, 'none');
    expect((await call('/api/login', { playerId: 'ryan', passcode }, 'none')).status).toBe(429);
  });
  it('invalidates existing sessions when a credential is rotated', async () => {
    const response = await worker.fetch(new Request('https://event.test/api/state', { headers: { cookie: cookies.jimmy } }), { DB: db, PLAYER_PASSCODES: PLAYER_PASSCODES.replaceAll(salt, '11111111111111111111111111111111') });
    expect(response.status).toBe(401);
  });
  it('prevents a stale tab from writing as another player after shared-cookie login', async () => {
    await signIn('jason');
    const requestId = crypto.randomUUID();
    const result = await call('/api/actions', { action: adjust(), requestId, expectedPlayerId: 'jason' }, 'jimmy');
    expect(result.status).toBe(401);
    expect(result.body.code).toBe('SESSION_CHANGED');
    expect(db.state().balances['corey-jimmy']).toBe(10_000_000);
    expect(db.row('SELECT COUNT(*) AS n FROM action_receipts').n).toBe(0);
    expect((await call('/api/state')).body.playerId).toBe('jimmy');
    expect((await action(adjust())).body.playerId).toBe('jimmy');
    expect((await call(`/api/actions/${requestId}?expectedPlayerId=jason`, undefined, 'jimmy')).body.code).toBe('SESSION_CHANGED');
  });
  it('checks the database for health and limits export to Jimmy', async () => {
    await signIn('jason');
    expect((await call('/api/export', undefined, 'jason')).status).toBe(403);
    expect((await call('/api/export')).body.ledgerAudit.length).toBe(4);
    db.sqlite.exec('DROP TABLE app_state');
    expect((await call('/api/health', undefined, 'none')).status).toBe(503);
  });
});

describe('atomic state, audit, and receipt commit', () => {
  it('upgrades an existing database without altering its state, ledger or old request history', async () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec(readFileSync(new URL('../migrations/0001_shared_state.sql', import.meta.url), 'utf8'));
      const snapshot = JSON.stringify({ ...db.state(), balances: { ...db.state().balances, 'corey-jimmy': 10_100_000 } });
      legacy.prepare('INSERT INTO app_state (id, revision, state_json, updated_at) VALUES (1, 19, ?, ?)').run(snapshot, '2026-09-01T00:00:00Z');
      legacy.prepare('INSERT INTO action_requests VALUES (?, ?, ?, ?, ?)').run('old-request', 'jimmy', 'ADJUST_BALANCE', '{"old":true}', '2026-09-01T00:00:00Z');
      legacy.prepare('INSERT INTO ledger_audit VALUES (?, ?, ?, ?, ?, ?)').run('old-ledger', 'corey-jimmy', 100000, 'admin-adjustment', 'Old adjustment', '2026-09-01T00:00:00Z');
      legacy.exec(readFileSync(new URL('../migrations/0002_authoritative_actions.sql', import.meta.url), 'utf8'));
      expect(legacy.prepare('SELECT state_json FROM app_state').get().state_json).toBe(snapshot);
      expect(legacy.prepare('SELECT revision FROM app_state').get().revision).toBe(19);
      expect(legacy.prepare('SELECT amount FROM ledger_audit').get().amount).toBe(100000);
      expect(legacy.prepare('SELECT request_id FROM action_requests').get().request_id).toBe('old-request');
      expect(legacy.prepare('SELECT COUNT(*) AS n FROM action_receipts').get().n).toBe(0);
    } finally { legacy.close(); }
  });
  it.each(['INSERT INTO ledger_audit', 'INSERT INTO ledger_context', 'INSERT INTO action_receipts'])('rolls back every write when %s fails, then safely retries', async (pattern) => {
    const requestId = crypto.randomUUID();
    db.failPattern = pattern;
    expect((await action(adjust(), requestId)).status).toBe(503);
    expect(db.state().balances['corey-jimmy']).toBe(10_000_000);
    expect(db.row('SELECT revision FROM app_state').revision).toBe(1);
    expect(db.row('SELECT COUNT(*) AS n FROM ledger_audit').n).toBe(4);
    expect((await call(`/api/actions/${requestId}`)).status).toBe(404);
    db.failPattern = null;
    expect((await action(adjust(), requestId)).status).toBe(200);
    expect((await action(adjust(), requestId)).status).toBe(200);
    expect(db.state().balances['corey-jimmy']).toBe(10_100_000);
    expect(db.row("SELECT SUM(amount) AS n FROM ledger_audit WHERE entry_type = 'admin-adjustment'").n).toBe(100_000);
  });
  it('returns original receipt after a commit response is lost and after later writes', async () => {
    const requestId = crypto.randomUUID();
    db.loseCommitResponse = true;
    const result = await action(adjust(), requestId);
    expect(result.status).toBe(200);
    await action(adjust(200_000));
    const replay = await action(adjust(), requestId);
    expect(replay.body.state).toEqual(result.body.state);
    expect(replay.body.revision).toEqual(result.body.revision);
    expect((await call(`/api/actions/${requestId}`)).body.state).toEqual(result.body.state);
    expect(db.state().balances['corey-jimmy']).toBe(10_300_000);
  });
  it('refreshes server time on late receipt recovery while preserving accepted state and revision', async () => {
    const requestId = crypto.randomUUID();
    const result = await action(adjust(), requestId);
    const later = new Date(Date.parse(result.body.serverTime) + 120_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(later);
    try {
      const recovered = await call(`/api/actions/${requestId}?expectedPlayerId=jimmy`);
      const replayed = await action(adjust(), requestId);
      for (const response of [recovered, replayed]) {
        expect(response.body.serverTime).toBe(later.toISOString());
        expect(response.body.state).toEqual(result.body.state);
        expect(response.body.revision).toBe(result.body.revision);
      }
    } finally { vi.useRealTimers(); }
  });
  it('binds request IDs to the actor and canonical payload', async () => {
    const requestId = crypto.randomUUID();
    await action(adjust(), requestId);
    expect((await action(adjust(200_000), requestId)).body.code).toBe('REQUEST_KEY_REUSED');
    const equivalent = { note: 'Verified adjustment', amount: 100000, teamId: 'corey-jimmy', type: 'ADJUST_BALANCE' };
    expect((await action(equivalent, requestId)).status).toBe(200);
    await signIn('jason');
    expect((await action(adjust(), requestId, 'jason')).body.code).toBe('REQUEST_KEY_REUSED');
    expect((await call(`/api/actions/${requestId}`, undefined, 'jason')).status).toBe(404);
  });
  it('never reapplies a legacy request with an unverifiable old receipt', async () => {
    const requestId = crypto.randomUUID();
    db.sqlite.prepare('INSERT INTO action_requests VALUES (?, ?, ?, ?, ?)').run(requestId, 'jimmy', 'ADJUST_BALANCE', null, '2026-09-01T00:00:00Z');
    expect((await action(adjust(), requestId)).body.code).toBe('LEGACY_REQUEST');
    expect(db.state().balances['corey-jimmy']).toBe(10_000_000);
  });
  it('rebases concurrent actions without losing either ledger entry', async () => {
    db.coordinateReads();
    const results = await Promise.all([action(adjust(100_000)), action(adjust(200_000))]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(db.state().balances['corey-jimmy']).toBe(10_300_000);
    expect(db.row('SELECT revision FROM app_state').revision).toBe(3);
    expect(db.row('SELECT COUNT(*) AS n FROM action_receipts').n).toBe(2);
    expect(db.row('SELECT COUNT(*) AS n FROM write_guards').n).toBe(0);
  });
  it('applies concurrent duplicates exactly once', async () => {
    db.coordinateReads();
    const requestId = crypto.randomUUID();
    const results = await Promise.all([action(adjust(), requestId), action(adjust(), requestId)]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.state).toEqual(results[1].body.state);
    expect(results[0].body.revision).toBe(results[1].body.revision);
    expect(db.state().balances['corey-jimmy']).toBe(10_100_000);
  });
  it('preserves terminal rejection so the same key never becomes accepted later', async () => {
    const requestId = crypto.randomUUID();
    const result = await action({ type: 'END_GAME_NIGHT' }, requestId);
    expect(result.status).toBe(409);
    await action({ type: 'START_GAME_NIGHT' });
    expect((await action({ type: 'END_GAME_NIGHT' }, requestId)).body).toEqual(result.body);
    expect(db.state().gameNight.status).toBe('active');
    expect((await call(`/api/actions/${requestId}`)).status).toBe(409);
  });
});
