// Generate local credentials without printing secrets. Never deploy the plaintext file.
import { randomBytes, pbkdf2Sync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const players = ['jason', 'ezra', 'corey', 'jimmy', 'brandon', 'andrew', 'bruce', 'ryan'];
const output = '.private-player-passcodes.json';
if (existsSync(output) || existsSync('.private-player-hashes.json') || (existsSync('.dev.vars') && /^PLAYER_PASSCODES=/m.test(readFileSync('.dev.vars', 'utf8')))) {
  throw new Error('Credentials already exist. Back up and remove old credential files before deliberately rotating them.');
}
const hashes = {};
const passcodes = {};
for (const player of players) {
  const passcode = randomBytes(9).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const hash = pbkdf2Sync(passcode, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  passcodes[player] = passcode;
  hashes[player] = `pbkdf2$100000$${salt}$${hash}`;
}
writeFileSync(output, JSON.stringify(passcodes, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const previous = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').trimEnd() + '\n' : '';
writeFileSync('.dev.vars', previous + `PLAYER_PASSCODES='${JSON.stringify(hashes)}'\n`, { mode: 0o600 });
writeFileSync('.private-player-hashes.json', JSON.stringify(hashes) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Generated .dev.vars, .private-player-passcodes.json and .private-player-hashes.json. Share each player only their own passcode.');
console.log('For a selected remote environment, pipe .private-player-hashes.json into wrangler secret put PLAYER_PASSCODES --env <environment>.');
console.log('Rotating a player hash invalidates that player’s existing sessions. Keep all three files private and out of version control.');
