# Frontend contract

## Navigation

The current app has four primary views: Home, Match Setup, Heat, and Bank. Desktop uses a side navigation; phone layouts use a fixed bottom navigation with safe-area padding. Match Setup is the live-night center: Jimmy starts the night there, players build/open markets and operate normal rounds, and Jimmy handles closeout.

The Heat view presents current-night Heat as an entertainment signal, factual W–L records, the four-appearance recency window, Prep/Live source labels, game-specific form, and the frozen-market explanation. It does not calculate or replace accepted market odds.

Match Setup keeps the next live-market builder near the top of the page while fewer than four markets are active. Active markets are listed separately with their own clock, betting state, result controls, and confirmed event identity. Reaching four active markets shows the limit and removes the builder. Settling or voiding one market removes only that market from the active list, so the remaining markets continue unchanged.

Jimmy’s Commissioner recovery panel labels expired pre-play markets and offers a finite 60-second, 90-second, or two-minute “Reopen betting” action. The existing “Void / refund” action remains separate. The UI only presents this action to Jimmy; the Worker remains the authorization boundary.

## Responsive expectations

The ordinary loop must work on phone-sized viewports with touch targets of at least the existing 44–48px controls, readable money/countdown text, and no dependence on hover. Horizontal game tabs may scroll or wrap. The display should keep the next action, current matchup, betting state, team banks, and last result legible at room distance; a future spectator view must not carry commissioner credentials.

## Confirmed, pending, and offline UI

- **Shared live:** show that the snapshot is connected and mutations may be submitted.
- **Pending:** show that the house is confirming, save/identify the request, and disable additional writes and sign-out.
- **Rejected:** say the request was not accepted, clear its pending lock, and refresh confirmed state.
- **Uncertain:** keep the request recoverable, show `Resolve saved request`, and block more mutations until resolution.
- **Offline/stale:** show the last confirmed state as read-only, including last sync context. Never display an optimistic balance or accepted wager.

Use `store.dispatch` for all writes. Success toasts and accessible announcements are allowed only after the Worker returns an accepted response.

## Accessibility expectations

Keep semantic headings and labelled forms; use visible focus styles; preserve keyboard operation; expose errors with `role="alert"`; expose sync/request changes with polite live regions; give navigation and tabs appropriate labels/roles/selection state; keep disabled controls understandable; provide meaningful alternative text or intentional empty alt for decorative imagery; and ensure color is not the only state signal.

Critical journeys have lightweight Playwright accessibility assertions for accessible names, keyboard-reachable primary actions, visible focus, associated login errors, status text, confirmation paths, and phone-width overflow. Representative screenshots are captured as deterministic test artifacts for login, concurrent markets, commissioner recovery, recap, and offline/pending states; they are not a large pixel-baseline suite.

When changing a control or layout, test ordinary player and commissioner paths at phone-sized viewports and while disconnected or pending. The UI is not a security boundary: hidden buttons do not replace Worker authorization.
