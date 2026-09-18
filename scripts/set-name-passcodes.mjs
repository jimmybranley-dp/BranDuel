// Deliberately weak credentials for a short-lived test environment.
// Pass the shared value through LOCAL_TEST_PASSCODE; never hard-code it here.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const players = ['jason', 'ezra', 'corey', 'jimmy', 'brandon', 'andrew', 'bruce', 'ryan'];
const passcode = process.env.LOCAL_TEST_PASSCODE;
if (!passcode) throw new Error('Set LOCAL_TEST_PASSCODE before updating local test passcodes.');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const files = ['.private-player-passcodes.json', '.private-player-hashes.json', '.dev.vars'];

for (const file of files) {
  if (!existsSync(file)) continue;
  const extension = file.endsWith('.json') ? '.json' : '';
  const base = extension ? file.slice(0, -extension.length) : file;
  copyFileSync(file, `${base}.before-name-passcodes-${stamp}${extension}`);
}

const passcodes = Object.fromEntries(players.map(player => [player, passcode]));
const hashes = Object.fromEntries(players.map(player => {
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(passcode, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  return [player, `pbkdf2$100000$${salt}$${hash}`];
}));

writeFileSync('.private-player-passcodes.json', JSON.stringify(passcodes, null, 2) + '\n', { mode: 0o600 });
writeFileSync('.private-player-hashes.json', JSON.stringify(hashes) + '\n', { mode: 0o600 });

const secretLine = `PLAYER_PASSCODES='${JSON.stringify(hashes)}'`;
const existing = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '';
const next = /^PLAYER_PASSCODES=.*$/m.test(existing)
  ? existing.replace(/^PLAYER_PASSCODES=.*$/m, secretLine)
  : `${existing.trimEnd()}${existing.trim() ? '\n' : ''}${secretLine}\n`;
writeFileSync('.dev.vars', next.endsWith('\n') ? next : `${next}\n`, { mode: 0o600 });

console.log('Set all eight local test passcodes to the supplied shared value. Previous credential files were backed up locally.');
