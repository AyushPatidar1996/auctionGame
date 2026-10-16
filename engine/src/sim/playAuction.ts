import type { Phase } from "../constants";
import { decide } from "../cpu/decide";
import { lineupAction } from "../cpu/lineup";
import { randomProfiles, type CpuProfile } from "../cpu/profiles";
import { createGame } from "../engine/create";
import { reduce } from "../engine/reduce";
import { viewFor } from "../engine/view";
import { createRng, deriveSeed } from "../random";
import type { Action, AuctionState, Ctx, Millis, RuleSet, TeamId, TeamSetup } from "../types";

// Neutral names on purpose: no real franchise names or trademarks.
const TEAM_NAMES = [
  "Falcons", "Gladiators", "Hawks", "Knights", "Lions",
  "Mavericks", "Panthers", "Rangers", "Strikers", "Vipers",
];

export function defaultTeams(count: number): TeamSetup[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `t${i + 1}`,
    name: TEAM_NAMES[i] ?? `Team ${i + 1}`,
    kind: "cpu" as const,
    profileId: `random-${i + 1}`,
    participantId: null,
  }));
}

export interface Step {
  readonly action: Action;
  readonly before: AuctionState;
  readonly after: AuctionState;
}

export interface PlayOptions {
  readonly ctx: Ctx;
  readonly rules: RuleSet;
  readonly seed: number;
  readonly teams?: readonly TeamSetup[];
  readonly profiles?: readonly CpuProfile[];
  readonly startAt?: Millis;
  /** The CPU brain; defaults to the random baseline. Lets tests (and M3) swap it. */
  readonly decide?: typeof decide;
  /** Called after every accepted action, in order. */
  readonly onStep?: (step: Step) => void;
}

export interface PlayResult {
  /** The empty SETUP game the actions were applied to. */
  readonly initial: AuctionState;
  readonly state: AuctionState;
  /** Every accepted action in order. Replaying them on `initial` reproduces `state`. */
  readonly actions: readonly Action[];
}

const THINK_MIN_MS = 500;
const THINK_SPREAD_MS = 3500;
const BANNER_MS = 1500;
const MAX_STEPS_PER_LOT = 100_000;

/**
 * Plays a whole auction headlessly with CPU teams on a virtual clock: START, then every
 * lot (each CPU "thinks" for a random delay, then decides), then every lineup. Pure and
 * deterministic: the same options give the same game. Doubles as the M3 simulator.
 */
export function playAuction(options: PlayOptions): PlayResult {
  const { ctx, rules, seed, onStep } = options;
  const brain = options.decide ?? decide;
  const teams = options.teams ?? defaultTeams(rules.teams);
  const profiles = options.profiles ?? randomProfiles(seed, teams.length);
  const profileOf = new Map(teams.map((team, i) => [team.id, profiles[i] as CpuProfile]));
  const rng = createRng(deriveSeed(seed, "sim"));
  const think = (): number => THINK_MIN_MS + Math.floor(rng() * THINK_SPREAD_MS);

  let now = options.startAt ?? 1_000_000;
  const initial = createGame({
    gameId: `sim-${seed}`,
    mode: "offline",
    createdAt: now,
    hostId: null,
    datasetVersion: ctx.datasetVersion,
    rules,
  });
  let state = initial;
  const actions: Action[] = [];

  const apply = (action: Action): void => {
    const before = state;
    const result = reduce(ctx, state, action);
    if (result.error) {
      throw new Error(`playAuction: ${action.type} rejected as ${result.error}: ${JSON.stringify(action)}`);
    }
    state = result.state;
    if (state === before) return; // an accepted no-op (a TICK before the deadline)
    actions.push(action);
    onStep?.({ action, before, after: state });
  };

  // `apply` reassigns `state` from inside a closure, which TypeScript's narrowing cannot
  // see; reading the phase through a function keeps those checks honest.
  const phase = (): Phase => state.phase;

  const playLot = (): void => {
    const nextAt = new Map<TeamId, number>(state.teamOrder.map((id) => [id, now + think()]));
    for (let guard = 0; phase() === "LOT_OPEN"; guard++) {
      if (guard > MAX_STEPS_PER_LOT) throw new Error("playAuction: a lot never closed");
      const lot = state.lot;
      if (!lot) break;

      let actor: TeamId | undefined;
      let actAt = Infinity;
      for (const id of state.teamOrder) {
        const t = nextAt.get(id) ?? Infinity;
        if (t < actAt) { actor = id; actAt = t; }
      }
      if (actor === undefined || actAt >= lot.deadline) {
        now = Math.max(now, lot.deadline);
        apply({ type: "TICK", at: now });
        continue;
      }

      now = Math.max(now, actAt);
      const profile = profileOf.get(actor) as CpuProfile;
      const action = brain(ctx, viewFor(state, actor), actor, profile, rng, now);
      if (!action) { nextAt.set(actor, now + think()); continue; }

      apply(action);
      const open = state.lot;
      if (action.type === "PASS") nextAt.set(actor, Infinity);
      if (action.type === "BID" && open) {
        for (const id of state.teamOrder) {
          const out = open.passed.includes(id) || id === actor;
          nextAt.set(id, out ? Infinity : now + think());
        }
      }
    }
  };

  now += 1000;
  apply({ type: "START", at: now, seed, teams });

  while (phase() === "BETWEEN_LOTS") {
    now += BANNER_MS;
    apply({ type: "NEXT_LOT", at: now });
    if (phase() === "LOT_OPEN") playLot();
  }

  for (const id of state.teamOrder) {
    if (phase() !== "SELECTING") break;
    now += 100;
    const action = lineupAction(ctx, viewFor(state, id), id, now);
    if (action) apply(action);
  }

  return { initial, state, actions };
}

/** Re-applies recorded actions to a fresh game; the result must equal the original. */
export function replayActions(
  ctx: Ctx,
  initial: AuctionState,
  actions: readonly Action[],
): AuctionState {
  let state = initial;
  for (const action of actions) {
    const result = reduce(ctx, state, action);
    if (result.error) throw new Error(`replay: ${action.type} rejected as ${result.error}`);
    state = result.state;
  }
  return state;
}
