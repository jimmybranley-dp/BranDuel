// Review-only reproductions. Uses an in-memory SQLite adapter, never a live D1 database.
// Run with Node 22.13+ from the project root: node review/probes.mjs
// These checks document defects in the reviewed build; they are not acceptance tests.
import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const bundled = await build({
  stdin: {
    contents: 'export { default as worker } from "./worker/index.ts"; export { createInitialState } from "./src/data.ts"; export { reducer } from "./src/store.tsx"; export { isBettingOpen } from "./src/engine.ts";',
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { worker, createInitialState, reducer, isBettingOpen } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

class MemoryD1 {
  sqlite = new DatabaseSync(':memory:');
  failAudit = false;
  prepare(sql) {
    const db = this;
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return db.sqlite.prepare(sql).get(...values) ?? null; },
      async run() {
        if (db.failAudit && sql.startsWith('INSERT OR IGNORE INTO ledger_audit')) {
          throw new Error('Injected audit write failure');
        }
        const result = db.sqlite.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}

async function post(db, action, actorId = 'jason', requestId = crypto.randomUUID()) {
  const response = await worker.fetch(new Request('https://review.invalid/api/actions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, actorId, requestId }),
  }), { DB: db });
  return { status: response.status, body: await response.json() };
}

const observations = [];

{
  const db = new MemoryD1();
  const injected = createInitialState();
  injected.balances['jason-ezra'] = 123;
  const response = await post(db, { type: 'HYDRATE_REMOTE', state: injected });
  assert.equal(response.status, 200);
  const persisted = JSON.parse(db.sqlite.prepare('SELECT state_json FROM app_state').get().state_json);
  assert.equal(persisted.balances['jason-ezra'], 123);
  observations.push({ finding: 'Non-commissioner API request can replace shared state via internal HYDRATE_REMOTE action', status: response.status, persistedBalance: 123 });
  db.close();
}

{
  const db = new MemoryD1();
  db.failAudit = true;
  const requestId = crypto.randomUUID();
  const action = { type: 'ADJUST_BALANCE', teamId: 'corey-jimmy', amount: 100000, note: 'Review probe' };
  const first = await post(db, action, 'jimmy', requestId);
  assert.equal(first.status, 409);
  db.failAudit = false;
  const second = await post(db, action, 'jimmy', requestId);
  assert.equal(second.body.state.balances['corey-jimmy'], 10200000);
  const audit = db.sqlite.prepare('SELECT SUM(amount) AS amount FROM ledger_audit').get();
  assert.equal(audit.amount, 100000);
  observations.push({ finding: 'Failure after state commit permits same request to apply twice and leaves audit short', firstStatus: first.status, retryStatus: second.status, balanceIncrease: 200000, auditedIncrease: audit.amount });
  db.close();
}

{
  const db = new MemoryD1();
  const response = await post(db, {
    type: 'SETTLE_FFA_EVENT', eventId: 'evt-boomerang-ffa',
    orderedPlayerIds: ['ezra', 'ezra', 'ezra', 'ezra'],
  });
  assert.equal(response.body.state.balances['jason-ezra'], 10250000);
  observations.push({ finding: 'Duplicate FFA finishers accepted through API and receive whole purse', status: response.status, recipientBalance: response.body.state.balances['jason-ezra'] });
  db.close();
}

{
  let state = reducer(createInitialState(), { type: 'REOPEN_EVENT', eventId: 'evt-smash-opener' });
  const event = state.events.find(item => item.id === 'evt-smash-opener');
  const stillOpen = isBettingOpen(event, Date.now() + 2 * 3600000);
  assert.equal(stillOpen, true);
  observations.push({ finding: 'Reopen 1 hr flag keeps betting open beyond the new deadline', openTwoHoursLater: stillOpen });
}

{
  let state = reducer(createInitialState(), { type: 'START_GAME_NIGHT' });
  state = reducer(state, { type: 'CREATE_LIVE_EVENT', payload: {
    gameId: 'smash', format: 'teams', teamIds: ['jason-ezra', 'corey-jimmy'], bettingSeconds: 90,
  } });
  const openMarkets = state.events.filter(event => isBettingOpen(event)).length;
  assert.equal(openMarkets, 4);
  observations.push({ finding: 'One active live round coexists with three bettable seeded scheduled events', openMarkets });
}

console.log(JSON.stringify({ environment: 'In-memory SQLite adapter; no network, no live D1 writes', observations }, null, 2));
