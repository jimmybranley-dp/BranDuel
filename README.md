# BranDuel

BranDuel is the competition, rankings, team economy, and betting app for the Degenerate Derby.

## Included in this build

- Eight selectable players across four fixed teams
- Shared $10,000,000 starting bankrolls
- Scheduled team and free-for-all events
- Live Game Night sessions with one active market at a time
- 60, 90, or 120 second betting windows with manual match start
- In-place result settlement, run-it-back controls, and final-night recaps
- Game-specific Elo ratings with an overall-skill factor in betting odds
- House-funded match payouts and wagers
- One editable shared team ticket per market
- Self-bet and teammate betting restrictions
- Ordered free-for-all results and split payouts
- Automatic betting closure, settlement, cancellation refunds, and transaction history
- Game leaderboards for Smash, Boomerang Fu, Worms, and Mario Party
- Jimmy-only commissioner controls during the player-picker test phase
- Shared Cloudflare D1 state with two-second device synchronization
- Server-controlled betting deadlines, settlement, and commissioner actions
- Duplicate-action protection for wagers and payouts
- Local browser fallback when the shared house is unavailable

## Run locally

Node.js 22 or newer is required.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. The Cloudflare Vite integration starts the React app, Worker API, and a persistent local D1 database together.

## Verify

```bash
npm test
npm run build
```

## Deploy to Cloudflare

Authenticate Wrangler and create the production database:

```bash
npx wrangler login
npx wrangler d1 create branduel-db
```

Copy the returned database ID into `wrangler.jsonc`, replacing the placeholder ID. Then apply the schema and deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

The player picker remains the test identity mechanism. Selecting Jimmy grants commissioner controls, so production access still requires passcodes or another authentication method.
