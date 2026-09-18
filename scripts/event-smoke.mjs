// Run only against a fresh isolated local server (BRANDUEL_STATE_PATH=.wrangler/qa-unique).
// This exercises real Worker/D1 behavior without changing the persistent local league.
import assert from 'node:assert/strict';
import { assertDestructiveTestTarget, assertIsolatedLocalStatePath } from '../src/operation-safety.ts';

const base = assertDestructiveTestTarget(process.argv[2] ?? 'http://127.0.0.1:5174', 'event rehearsal');

if (!process.env.BRANDUEL_STATE_PATH) throw new Error('Set BRANDUEL_STATE_PATH to a new isolated state directory before this rehearsal.');
assertIsolatedLocalStatePath(process.env.BRANDUEL_STATE_PATH);

const passcode = process.env.BRANDUEL_TEST_PASSCODE;
if (!passcode) throw new Error('Set BRANDUEL_TEST_PASSCODE to an ephemeral rehearsal passcode.');
const actionLatencyLimit = Number(process.env.BRANDUEL_ACTION_MAX_MS ?? 2_000);
const healthLatencyLimit = Number(process.env.BRANDUEL_HEALTH_MAX_MS ?? 1_000);
if (!Number.isFinite(actionLatencyLimit) || actionLatencyLimit <= 0 || !Number.isFinite(healthLatencyLimit) || healthLatencyLimit <= 0) throw new Error('Latency limits must be positive finite numbers.');
const cookieJars = new Map();
const observations = [];

async function request(player, path, body, expected = 200) {
  const headers = { origin: base.origin, accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookieJars.has(player)) headers.cookie = cookieJars.get(player);
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST', headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookie = response.headers.get('set-cookie');
  if (cookie) cookieJars.set(player, cookie.split(';')[0]);
  const payload = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(payload)}`);
  return payload;
}
const act = (player, action, expected = 200, requestId = crypto.randomUUID()) =>
  (async () => {
    const startedAt = performance.now();
    const result = await request(player, '/api/actions', { action, requestId, expectedPlayerId: player }, expected);
    const duration = performance.now() - startedAt;
    assert.ok(duration <= actionLatencyLimit, `Action ${action.type} exceeded ${actionLatencyLimit}ms (${duration.toFixed(1)}ms).`);
    return result;
  })();

const healthStartedAt = performance.now();
await request('anonymous', '/api/health');
assert.ok(performance.now() - healthStartedAt <= healthLatencyLimit, `Health exceeded ${healthLatencyLimit}ms.`);
await request('anonymous', '/api/state', undefined, 401);
for (const player of ['jimmy', 'jason', 'ezra', 'brandon']) {
  await request(player, '/api/login', { playerId: player, passcode });
}
const initial = await request('jimmy', '/api/state');
assert.equal(initial.state.events.length, 0, 'Use a fresh ephemeral server, not an existing league.');
assert.ok(!initial.state.gameNight, 'Use a fresh ephemeral server.');
observations.push('Unauthenticated state is blocked; four independent sessions log in.');

await act('jason', { type: 'HYDRATE_REMOTE', state: initial.state }, 400);
await act('jimmy', { type: 'START_GAME_NIGHT' });
const opened = await act('ezra', { type: 'CREATE_LIVE_EVENT', payload: {
  gameId: 'smash', format: 'teams', teamIds: ['jason-ezra', 'corey-jimmy'], bettingSeconds: 90,
} });
const eventId = opened.state.gameNight.activeEventId;
const ticket = { type: 'PLACE_BET', eventId, selectionId: 'jason-ezra', stake: 50000 };
const requestId = crypto.randomUUID();
await Promise.all([
  act('jason', ticket, 200, requestId),
  act('brandon', { ...ticket, stake: 100000 }),
]);
await act('jason', ticket, 200, requestId);
await request('jason', `/api/actions/${requestId}?expectedPlayerId=jason`);
await act('jason', { ...ticket, stake: 500000 }, 409, requestId);
await Promise.all([
  act('jason', { ...ticket, stake: 100000 }),
  act('ezra', { ...ticket, stake: 75000 }),
]);
const betState = await request('jimmy', '/api/state');
assert.equal(betState.state.bets.filter(b => b.teamId === 'jason-ezra' && b.status === 'open').length, 1);
assert.equal(betState.state.bets.filter(b => b.status === 'open').length, 2);
observations.push('Concurrent team edits and opponents converge; replay is accepted once and changed payload is rejected.');

await act('brandon', { type: 'START_MATCH', eventId });
await act('jason', ticket, 409);
await act('jason', { type: 'SETTLE_TEAM_EVENT', eventId, winningTeamId: 'jason-ezra' });
await act('jimmy', { type: 'CORRECT_RESULT', eventId, result: { winningTeamId: 'corey-jimmy' }, reason: 'Corrected winner in local rehearsal' });
await act('jimmy', { type: 'CANCEL_EVENT', eventId, reason: 'Void completed rehearsal round' });
const voided = await request('jimmy', '/api/state');
assert.deepEqual(voided.state.balances, initial.state.balances);
for (const team of Object.keys(initial.state.balances)) {
  assert.equal(voided.state.ledger.filter(e => e.teamId === team).reduce((sum, e) => sum + e.amount, 0), voided.state.balances[team]);
}
observations.push('Late betting is rejected; player reports, commissioner correction and completed-round void reconcile every bank.');

const ffa = await act('brandon', { type: 'CREATE_LIVE_EVENT', payload: {
  gameId: 'boomerang', format: 'free-for-all', playerIds: ['jason', 'corey', 'brandon', 'bruce'], bettingSeconds: 60,
} });
const ffaId = ffa.state.gameNight.activeEventId;
await act('jimmy', { type: 'END_GAME_NIGHT' }, 409);
await act('ezra', { type: 'START_MATCH', eventId: ffaId });
await act('jason', { type: 'SETTLE_FFA_EVENT', eventId: ffaId, orderedPlayerIds: ['jason', 'jason', 'jason', 'jason'] }, 400);
await act('jason', { type: 'SETTLE_FFA_EVENT', eventId: ffaId, orderedPlayerIds: ['jason', 'corey', 'brandon', 'bruce'] });
const closed = await act('jimmy', { type: 'END_GAME_NIGHT' });
assert.equal(closed.state.gameNight.status, 'ended');
assert.ok(closed.state.gameNight.finalSnapshot);
await request('jason', '/api/export', undefined, 403);
await request('jimmy', '/api/export');
await request('jason', '/api/logout', {});
await request('jason', '/api/state', undefined, 401);
observations.push(`FFA validation, unresolved-round closeout guard, frozen archive, commissioner export and logout passed; action latency stayed under ${actionLatencyLimit}ms and health under ${healthLatencyLimit}ms.`);
console.log(JSON.stringify({ environment: base.origin, observations }, null, 2));
