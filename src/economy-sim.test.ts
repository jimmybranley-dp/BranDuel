import { expect, it } from "vitest";
import { EconomySimulationError, inspectEconomyNight, simulateEconomy } from "./economy-sim";

const seed = Number(process.env.ECONOMY_SEED ?? 481516);
const nights = Number(process.env.ECONOMY_NIGHTS ?? 25);
const rounds = Number(process.env.ECONOMY_ROUNDS ?? 8);

it("runs reproducible server-authoritative economy nights", () => {
  try {
    const report = simulateEconomy({ seed, nights, rounds });
    console.log(JSON.stringify({ ...report, debtPercent: Math.round(report.debtNights / report.nights * 10000) / 100 }, null, 2));
    expect(report.endingBalances["jason-ezra"]).toHaveLength(nights);
  } catch (error) {
    if (error instanceof EconomySimulationError) console.error(JSON.stringify({ seed: error.seed, trace: error.trace, state: error.state, replay: error.replayCommand() }, null, 2));
    throw error;
  }
}, Number(process.env.ECONOMY_TIMEOUT_MS ?? 15_000));

if (process.env.ECONOMY_EXPLAIN_SEED) it("prints a replayable extreme-night inspection", () => {
  console.log(JSON.stringify(inspectEconomyNight(Number(process.env.ECONOMY_EXPLAIN_SEED), rounds), null, 2));
});
