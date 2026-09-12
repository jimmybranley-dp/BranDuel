import { expect, it } from "vitest";
import { createInitialState } from "./data";
import { buildSettlementPreview } from "./settlement";
import type { ScheduledEvent } from "./types";

it("distributes an FFA frozen purse when every participant is on one team", () => {
  const state = createInitialState();
  const event: ScheduledEvent = {
    id: "same-team-ffa", gameId: "smash" as const, format: "free-for-all" as const,
    playerIds: ["bruce", "ryan"], participants: { playerIds: ["bruce", "ryan"] },
    housePurse: 1_500_000, scheduledAt: new Date().toISOString(), status: "in-progress" as const,
    odds: {}, createdBy: "jimmy" as const, createdAt: new Date().toISOString(),
  };
  const preview = buildSettlementPreview(event, state, { orderedPlayerIds: ["ryan", "bruce"] });
  expect(preview.payouts).toEqual([{ teamId: "bruce-ryan", rank: 1, percentage: 100, amount: 1_050_000 }]);
});
