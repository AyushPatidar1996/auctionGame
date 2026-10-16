// Text-mode auction: plays a whole game with random-bid CPUs and prints it.
//   npm run play -- --seed 7            (from the repo root)
//   npm run play -- --seed 7 --quiet    (summary only)
//   npm run play -- --seed 7 --verbose  (also shows every pass)
import { readFileSync } from "node:fs";
import {
  checkRulesAgainstDataset,
  createCtx,
  isOverseas,
  loadDataset,
  loadRules,
  playAuction,
  squadPressure,
  type AuctionState,
  type Ctx,
  type Lakhs,
  type Step,
} from "../src";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const seedArg = args.indexOf("--seed");
const seed = seedArg >= 0 ? Number(args[seedArg + 1]) : 1;
const quiet = flag("quiet");
const verbose = flag("verbose");

const readData = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));

const dataset = loadDataset(readData("players.v1.json"));
const rules = loadRules(readData("rules.default.json"));
if (!dataset.ok || !rules.ok) {
  console.error([...(dataset.ok ? [] : dataset.errors), ...(rules.ok ? [] : rules.errors)].join("\n"));
  process.exit(1);
}
const R = rules.value;
const D = dataset.value;
const crosscheck = checkRulesAgainstDataset(R, D);
if (crosscheck.errors.length > 0) {
  console.error(crosscheck.errors.join("\n"));
  process.exit(1);
}
const ctx: Ctx = createCtx(D);

const money = (l: Lakhs): string => (l >= 100 ? `${(l / 100).toFixed(2)} Cr` : `${l} L`);
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const padL = (s: string | number, n: number): string => String(s).padStart(n);
const nameOf = (s: AuctionState, id: string): string => s.teams[id]?.name ?? id;
const player = (id: string) => ctx.players.get(id);

function describePlayer(id: string): string {
  const p = player(id);
  if (!p) return id;
  const role = p.type + (p.isKeeper ? "+WK" : "");
  return `${p.displayName} (${role}, ${p.nationality}, ${p.auctionTier})`;
}

function print(step: Step): void {
  const { action, before, after } = step;
  if (quiet) return;

  if (action.type === "START") {
    console.log(`Auction ${after.meta.gameId}: ${after.teamOrder.length} teams, ${after.lots.length} lots, purse ${money(R.purse)} each\n`);
    return;
  }
  if (action.type === "NEXT_LOT" && after.phase === "SELECTING") {
    console.log("\n--- all lots done; teams choose their playing 12 ---");
    return;
  }
  if (action.type === "NEXT_LOT") {
    const id = after.lots[after.lotIndex] as string;
    const forced = after.lot !== null && squadPressure(after).forced;
    console.log(
      `Lot ${padL(after.lotIndex + 1, 3)}/${after.lots.length}  ${describePlayer(id)}  base ${money(
        (after.lot ?? before.lot)?.basePrice ?? after.history.at(-1)?.basePrice ?? 0,
      )}${forced ? "  [FORCED LOT]" : ""}`,
    );
  } else if (action.type === "BID") {
    console.log(`           ${pad(nameOf(after, action.teamId), 11)} bids ${money(action.amount)}`);
  } else if (action.type === "PASS" && verbose) {
    console.log(`           ${pad(nameOf(after, action.teamId), 11)} passes`);
  }

  if (after.history.length > before.history.length) {
    const record = after.history[after.history.length - 1];
    if (record?.outcome === "sold") {
      const how = record.assignedBy === "forced" ? "ASSIGNED (forced lot)" : "SOLD";
      console.log(`           => ${how} to ${nameOf(after, record.teamId)} for ${money(record.price)}\n`);
    } else if (record) {
      console.log("           => UNSOLD\n");
    }
  }
}

const { state, actions } = playAuction({ ctx, rules: R, seed, onStep: print });

// ───── summary ─────
const min = R.squad.min;
console.log(`\n=== Final squads (seed ${seed}, ${actions.length} actions) ===`);
console.log(`${pad("Team", 11)} ${padL("Players", 7)} ${padL("Overseas", 8)} ${padL("Spent", 10)} ${padL("Purse left", 11)} ${padL("XII", 4)}`);
const warnings: string[] = [];
for (const id of state.teamOrder) {
  const team = state.teams[id]!;
  const spent = team.squad.reduce((sum, e) => sum + e.price, 0);
  const away = team.squad.filter((e) => {
    const p = player(e.playerId);
    return p !== undefined && isOverseas(p, R);
  }).length;
  const xii = team.lineup?.length ?? 0;
  console.log(`${pad(team.name, 11)} ${padL(team.squad.length, 7)} ${padL(away, 8)} ${padL(money(spent), 10)} ${padL(money(team.purse), 11)} ${padL(xii, 4)}`);
  if (team.squad.length < min) warnings.push(`${team.name} ended with ${team.squad.length} players, below the minimum of ${min}`);
  if (xii < R.lineup.size) warnings.push(`${team.name} could only name ${xii} players in its lineup`);
}

const sold = state.history.flatMap((r) => (r.outcome === "sold" ? [r] : []));
const forced = sold.filter((r) => r.assignedBy === "forced").length;
console.log(`\nSold ${sold.length} (${forced} assigned by the forced-lot rule), unsold ${state.unsold.length}, of ${state.history.length} lots`);
console.log("\nMost expensive buys:");
for (const r of [...sold].sort((a, b) => b.price - a.price).slice(0, 8)) {
  console.log(`  ${padL(money(r.price), 9)}  ${pad(describePlayer(r.playerId), 52)} -> ${nameOf(state, r.teamId)}`);
}
if (warnings.length > 0) {
  console.log("\nWARNINGS (known rules gaps, see PROJECT.md 'KNOWN HOLE'):");
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log(`\nPhase: ${state.phase}`);
