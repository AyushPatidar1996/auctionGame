# IPL Auction Game

Living design doc. Updated as decisions are made. Nothing here is final unless
marked **Decided**.

---

## 1. The idea

A cricket auction game. Teams bid on real IPL players within a fixed purse to
build a squad. Squads are then scored on two axes:

- **Brand appeal** — star power, marketability, fan draw
- **Performance** — on-field output of the squad

Opponents can be CPU teams or other human players.

The interesting tension: the best squad on paper is not automatically the
best-scoring squad, because purse is finite and the two scoring axes pull in
different directions.

---

## 2. Working agreement

- Ayush writes all the code.
- Claude's role: explain, discuss design, review code, help debug.
- Claude does not create or edit code files. Markdown docs like this one are fine.

---

## 3. Architecture

### 3.1 Current focus: the game engine

Lives in `engine/` (was `Game Engine/`, renamed 2026-10-16). TypeScript.

**Shape:** a pure state machine.

```
reduce(ctx: { players }, state: AuctionState, action: Action)
  -> { state: AuctionState, error: RejectReason | null }
```

A rejected action returns the **same state object** (revision unchanged) plus a
reason code. See section 4.5.

**Rules it must obey:**

| Rule | Why |
| --- | --- |
| Pure — no side effects, no I/O | Replayable, testable, same result everywhere |
| Time is injected, never read inside | `Date.now()` inside would break determinism |
| Randomness is injected (seed or roll) | Same seed + same actions = same auction |
| Player data loaded from outside | Engine doesn't fetch, parse, or own the dataset |
| No platform-specific code | Must run identically in browser, server, mobile |

**Why this shape:** one engine, three hosts. The host (web app, game server,
mobile app) owns the clock, the network, storage, and rendering. The engine
owns only the rules.

### 3.2 Layers

```
┌─────────────────────────────────────────┐
│  Hosts: Browser / Server / Mobile       │  clock, network, storage, UI
├─────────────────────────────────────────┤
│  Game Engine (pure TS)                  │  rules, state transitions
├─────────────────────────────────────────┤
│  Player dataset (injected)              │  real IPL players + attributes
└─────────────────────────────────────────┘
```

### 3.2a Where code runs (Decided)

- **Offline (M1–M3) is 100% client-side.** Engine, CPU, scoring and the host loop
  all run in the browser. Dataset and rules are static files, so the app deploys
  on any static host. Save/resume uses IndexedDB/localStorage (seed + action log).
  No accounts, no backend. CPU can move to a Web Worker later if needed.
- **Backend exists only for online play (M4)**, and it is the referee, not just
  storage: it runs the same pure engine, owns the clock (`TICK`) and the RNG seed,
  runs CPU seats, and manages rooms (join/leave/reconnect, realtime broadcast).
  Clients send intended actions, never state. Server persistence is only for
  reconnect/crash recovery.
- The UI talks to a host interface (`dispatch`, `subscribe`, `now`). Offline it is a
  local implementation; online it is a WebSocket client with the same shape.
- Engine and CPU must not import browser-only or server-only APIs. Nothing in the
  dataset may be secret (it ships to every client).

### 3.2b Repo layout (Decided)

npm workspaces (root `package.json`):

```
Auction game/
  data/     shared static JSON (players.v1.json, rules.default.json, shortlist/notes)
  engine/   @auction/engine: pure TS. tsconfig has "types": [] so DOM/Node APIs fail to
            compile in src/. Tests (tests/) use tsconfig.test.json with Node types.
  web/      Vite + React + TypeScript; imports the engine by name (source via "main")
  (server/  added in M4, importing the same engine)
```

- Scripts from the root: `npm test` (engine, Vitest), `npm run typecheck`, `npm run dev`,
  `npm run build`, and `npm run play -- --seed 7` (text-mode auction, see 4.7; add
  `--quiet` for the summary only or `--verbose` to also show passes).
- `engine` is imported as TypeScript source (`"main": "src/index.ts"`); no build step.
- **Node 22** (via fnm; `.node-version` = 22, root `engines` >= 22.12). Tooling is
  current: Vite 8, `@vitejs/plugin-react` 6, Vitest 4, TypeScript 6.
- **npm resolver bug:** `npm install` with the bundled npm 10.9 fails from a clean tree
  (`Cannot read properties of null (reading 'edgesOut')`). The lockfile was generated
  with `npx npm@11 install`; `npm ci` and the scripts work with npm 10 afterwards.
  If dependencies change, regenerate with `npx -y npm@11 install`.

### 3.3 Open architectural questions

These change the data model, so they're worth settling early.

1. **Where does the bid timer live?**
   A pure engine can't tick. Likely answer: state holds a deadline, and the host
   sends a `TICK` / `TIMER_EXPIRED` action carrying the current time. Decides
   whether state stores absolute timestamps or durations.

2. **Is CPU bidding inside or outside the engine?**
   - *Inside:* a pure function of state + injected random. Fully replayable.
   - *Outside:* host computes it, sends a normal bid action. Engine stays smaller.

3. **Is scoring part of the engine?**
   Leaning: no. A separate pure module that takes a finished squad and returns
   brand + performance scores. Keeps the auction state machine about bidding only.

---

## 4. Data model

**Status: `Player` decided (below). `Team`, `RuleSet`, `AuctionState`, `Action` still to design.**

### 4.1 Player (Decided)

Static, immutable, versioned JSON in `data/players.v<N>.json` (top-level
`datasetVersion`). Engine state stores `PlayerId` only; the dataset is injected.

```
id, name, displayName,
nationality,                       // "overseas" is derived from rules.homeCountry
auctionTier: marquee | A | B | C,  // lot ordering + base price lookup
type: bat | bowl | all-rounder,
isKeeper: boolean,
battingHand: L | R,
batType:  opener | middle | anchor | finisher | null,
bowlType: pace | offSpin | legSpin | leftArmOrthodox | chinaman | null,
bowlingArm: L | R | null,
bowlPhases: (powerplay | middle | death)[],
batScore, bowlScore, fieldScore, brandAppeal   // integers 0–100, 0 = doesn't do this
```

- **Ids are permanent (Decided).** `p001`–`p300` are assigned once and never
  renumbered or reused, so removed players leave gaps (11 removed on 2026-10-16,
  e.g. `p010`). New players take the next unused id (`p301`+). The loader should
  reject a dataset version where an id that existed before now refers to a
  different player. Saved games and replays rely on this.
- No `basePrice` on the player. Base price = `rules.tierBasePrice[auctionTier]`.
- Money is integer lakhs everywhere. No floats.
- Validator: a type field (`batType`, `bowlType`) is non-null iff its score
  is above a threshold (20). Duplicate ids, unknown enums, empty tiers fail at load.
- `auctionTier` is an authoring label. Never derive it from scores at runtime.

### 4.2 Squad, lineup and scoring (Decided)

- At the end of the auction each team picks a **playing 12** from its squad.
  Squad min must therefore be >= 12.
- New phases after the last lot: `SELECTING` then `FINISHED`.
  `SUBMIT_LINEUP { teamId, playerIds }` is a normal reducer action.
- Lineup legality (size 12, subset of own squad, overseas cap, keeper/bowling
  minimums) lives in `RuleSet`, shared by the human UI and CPU.
- CPU teams auto-pick the best legal 12 (greedy in M1, better in M3).
- Scoring is a separate pure module, `score(squad, lineup)`, returning
  strength by aspect (batting top/middle/finish, pace, spin, death, keeping,
  fielding), **balance** (coverage of slots, 0–1), **brand appeal**, and
  **bench strength** (players outside the 12, small weight so teams don't hoard).
- Open: is the 12 a flat 12, or XI + 1 impact player? (Affects lineup validation.)

### 4.3 AuctionState (Decided)

The state is a **complete snapshot of one game**. The same schema is used
offline (in the browser) and persisted on the server for online games. Load it
and you can resume or inspect it without anything else (given the dataset
version, since player ids are permanent). Bid-by-bid replay is not part of the
state; if wanted, the host keeps the action log separately.

```
AuctionState {
  schemaVersion, revision              // revision +1 on every accepted action
  meta: { gameId, mode: offline | online, createdAt, startedAt|null,
          finishedAt|null, hostId|null }
  datasetVersion, rules, seed          // rules frozen at start; seed rebuilds the pool
  phase: SETUP | LOT_OPEN | BETWEEN_LOTS | SELECTING | FINISHED

  teams: Record<TeamId, Team>, teamOrder: TeamId[]
  seats: Record<TeamId, ParticipantId | null>   // who controls each team

  lots: PlayerId[]                     // full auction order, fixed at START
  lotIndex                             // -1 before the first lot
  lot: Lot | null                      // open lot (LOT_OPEN only; null otherwise)
  unsold: PlayerId[]
  history: LotRecord[]                 // every closed lot: outcome only, no bid trail
  lastActionAt
}

Team {
  id, name, kind: human | cpu, profileId|null,
  purse,                               // remaining, integer lakhs
  squad: { playerId, price, lotIndex }[],   // players owned right now
  lineup: PlayerId[] | null            // playing 12, set in SELECTING
}

Lot { playerId, basePrice, highBid: {teamId, amount}|null,
      deadline,                        // absolute ms, moves on each valid bid
      passed: TeamId[] }

LotRecord { playerId, basePrice, outcome: sold | unsold, teamId?, price?,
            assignedBy?: bid | forced, closedAt }
// Per-lot bid trails are deliberately NOT stored (decided 2026-10-16: not needed).
// Add `bids` to Lot/LotRecord later if a feature requires it; bump schemaVersion.
```

**Rules of the schema**
- State holds **facts, not computations.** Derived values are pure selectors:
  next valid bid, remaining slots, overseas count, reserve required, eligible
  teams, progress, and final scores (`scoreGame(state, ctx)`).
- **No player data in state**, only ids; the player map comes in via `ctx.players`.
  `rules` *is* in state (small; a reconnecting client needs it).
- **No ephemeral data in state:** presence, sockets and connection status live in
  the server's presence layer.
- **No external randomness in the reducer.** `START { seed }` builds the pool
  (stratified sample per `rules.pool`) and shuffles within tiers; after that, ties
  between simultaneous bids are resolved by the order the host sends actions. Pure
  seeded derivations from `state.seed` are allowed (forced assignment, see 4.5).
- **Time is injected.** Every action carries `at`; reducer rejects `at < lastActionAt`.
  `TICK { at }` closes the lot when `at >= deadline`.
- **Passing is supported:** a lot closes early when no other team can or will bid.
- **Explicit `NEXT_LOT`** moves BETWEEN_LOTS to the next LOT_OPEN (host controls pacing).
- Unsold players get one pass only in M1 (`unsold` kept so a later round can be added).
- `viewFor(state, viewer)` is a pure projection giving each client / CPU its allowed
  slice (e.g. other teams' lineups hidden during SELECTING). The CPU's public view
  uses the same function.
- A `migrate(state)` stub exists from day one for `schemaVersion` changes.
- `ParticipantId` is an opaque string (accounts vs guest ids is an M4 decision).

**Invariants (tested after every transition)**
- Per team: `initialPurse - purse == sum(squad prices)`; purse never negative.
- No player appears in two squads, or in a squad and `unsold`.
- Squad size within `rules.squad`; overseas count within cap; `lineup` (if set) is
  12 distinct players, all from that team's squad, overseas within the lineup cap.
- `squad` and `purse` agree with what `history` implies.
- `revision` increases by exactly 1 per accepted action; rejected actions leave the
  state unchanged.

**Actions:** `START`, `NEXT_LOT`, `BID`, `PASS`, `TICK`, `SUBMIT_LINEUP`; see 4.5.

### 4.3a Still to design

- `RuleSet` types and validators — see 4.4

### 4.4 RuleSet (draft)

Lives in `data/rules.<preset>.json` (default: `rules.default.json`). Plain data;
validators live in the engine. **M1 values (Decided, in `data/rules.default.json`):**
10 teams, purse 2500, squad 15–25 (max 8 overseas), playing lineup 12 (max 4
overseas), `tierBasePrice` marquee 200 / A 100 / B 50 / C 20, increments
5 (<50) / 10 (<100) / 25 (<500) / 50 (500+), 10s bid window reset on each bid,
`lotOrder: by-tier-then-shuffle`.

- **Auction pool:** each game draws a seeded, stratified sample from the dataset
  (`pool.composition`: marquee 12, A 24, B 40, C 104 = 180). Needs
  `pool >= teams * squad.min` (150) and no tier count above what the dataset has.
- **Lineup hard rules:** size, subset of own squad, overseas cap only. Keeper and
  bowling coverage are *not* hard rules (a pool can leave a team with no keeper);
  they feed the balance score instead.
- **Purse sizing** (2500) is an estimate (~2.5x base price final average); tune with
  the M3 headless simulator. Unsold players are not re-auctioned in M1.
- The `RuleSet` itself is validated at load (min <= max, lineup <= squad min,
  reserve `squad.min * cheapest base price <= purse`, pool composition covers every
  tier and fits the dataset, base prices multiples of the smallest step,
  increments sorted and ending in exactly one `null`).

Data lives in `data/` (outside `Game Engine/`) so the engine stays free of
file I/O; types and validators stay in the engine.

---

### 4.5 Actions (Draft)

Every action has `type` and `at` (injected time). `at` must be >= `lastActionAt`
(else `TIME_WENT_BACKWARDS`). An accepted action bumps `revision` by 1 and sets
`lastActionAt = at`. Rejections change nothing.

**Phase flow:** `SETUP --START--> BETWEEN_LOTS --NEXT_LOT--> LOT_OPEN --(close)-->
BETWEEN_LOTS ... --NEXT_LOT (no lots left)--> SELECTING --(all lineups in)--> FINISHED`.

| Action | Payload | Valid in |
| --- | --- | --- |
| `START` | `seed`, `teams[{id,name,kind,profileId?}]`, `seats` | SETUP |
| `NEXT_LOT` | — | BETWEEN_LOTS |
| `BID` | `teamId`, `amount` | LOT_OPEN |
| `PASS` | `teamId` | LOT_OPEN |
| `TICK` | — | any (no-op unless it closes a lot) |
| `SUBMIT_LINEUP` | `teamId`, `playerIds[12]` | SELECTING |

**START** — builds the pool (stratified sample per `rules.pool`, seeded), orders it
by `tierOrder` with a seeded shuffle inside each tier, creates teams with
`purse = rules.purse`, empty squads. Rejects, in order: `WRONG_PHASE`,
`TIME_WENT_BACKWARDS`, `TEAM_COUNT_MISMATCH`, `INVALID_TEAMS` (blank or duplicate team
id/name), `DATASET_MISMATCH` (`ctx.datasetVersion` differs from `state.datasetVersion`),
`POOL_TOO_SMALL` (a tier has fewer players than asked, or the pool is below
`teams x squad.min`). Implemented in `engine/src/engine/start.ts`: candidates per tier
are sorted by id, shuffled with `deriveSeed(seed, "pool", tier)`, and the first
`composition[tier]` are taken, so the result depends on the seed only.

**NEXT_LOT** — opens lot `lotIndex+1`: `basePrice = tierBasePrice[tier]`,
`highBid = null`, `deadline = at + bidWindowMs`, `passed = []`. If no team can
afford/hold the player even at base price, the lot closes `unsold` immediately
(unless the lot is forced, see below). When no lots remain: go to `SELECTING`; every
team then holds at least `squad.min` players. Rejects: `WRONG_PHASE`.

**BID** — `amount` is required and must equal `nextBid` (base price for the first
bid, else `highBid + increment`). The amount guards against double clicks and
races: a stale click is rejected, never raises twice. Effects: set `highBid`;
if `resetOnBid`, `deadline = at + bidWindowMs`. Closes the lot at once (sold) if no
other team could still outbid. Rejects, in this order:
`WRONG_PHASE`, `UNKNOWN_TEAM`, `LOT_EXPIRED` (`at >= deadline`; host should TICK first),
`HAS_PASSED`, `QUOTA_MET` (forced lot, team already at `squad.min`), `ALREADY_HIGHEST`,
`STALE_AMOUNT`, `INSUFFICIENT_PURSE`
(`amount > purse`), `RESERVE_VIOLATION` (`purse - amount <` slots still needed to reach
`squad.min` times cheapest base price), `SQUAD_FULL`, `OVERSEAS_CAP`.

**PASS** — adds the team to `lot.passed`. Closes the lot early when no *contender*
remains (a contender = not passed, not the high bidder, can afford and hold the player
at the next bid): sold if there is a high bid, else unsold. Rejects, in order:
`WRONG_PHASE`, `TIME_WENT_BACKWARDS`, `UNKNOWN_TEAM`, `LOT_EXPIRED` (`at >= deadline`),
`ALREADY_PASSED`, `HIGH_BIDDER_CANNOT_PASS`, `FORCED_LOT`.

**TICK** — if phase is LOT_OPEN and `at >= deadline`, closes the lot (a forced lot with
no bid is assigned, see the forced-lot rule). Otherwise a
**no-op accepted without bumping revision** (hosts tick often).

**Closing a lot** (shared by TICK, BID and PASS): sold -> append
`{playerId, price, lotIndex}` to the winner's squad, `purse -= price`; unsold -> push to
`unsold`; append a `LotRecord`; `lot = null`; phase = BETWEEN_LOTS.

**SUBMIT_LINEUP** — validates size == `requiredLineupSize`, distinct players, all in the
team's own squad, overseas count <= `lineup.maxOverseas`. May be resubmitted until the
phase ends. When every team has a lineup: phase = FINISHED, `meta.finishedAt = at`; after
that the door is closed (`WRONG_PHASE`), so the last team to submit fixes its lineup.
Rejects, in order: `WRONG_PHASE`, `TIME_WENT_BACKWARDS`, `UNKNOWN_TEAM`,
`WRONG_LINEUP_SIZE`, `DUPLICATE_PLAYER`, `PLAYER_NOT_IN_SQUAD`, `LINEUP_OVERSEAS_CAP`.
The checks after the time check live in the shared pure `lineupError(state, ctx, teamId,
playerIds)`, which the lineup-picker UI and the CPU also call.

**Required lineup size (engine decision, 2026-10-17).** `requiredLineupSize` is
`min(rules.lineup.size, home + min(overseas, lineup.maxOverseas))` over the team's squad:
12 for any squad that can field a legal 12, otherwise the most it can field. Without this
a team with too few players or too few home players could never submit and the game would
never reach FINISHED. Remove it (use `rules.lineup.size` directly) once the rules
guarantee every squad can field a full 12; the invariant checker already asserts a named
lineup is legal and the right size.

**Measured effect of the deferred overseas rules (2026-10-17).** In 30 random-bid
auctions per profile, 26-28 of 30 left at least one team unable to field a full legal 12
(roughly 15-20% of all teams ended with 9-11 fieldable players). Cause: squad cap of 8
overseas but only 7 home players in a minimum squad of 15, and random bidders buy
overseas freely. A squad overseas cap of 7 (or the loader check
`squad.min - squad.maxOverseas >= lineup.size - lineup.maxOverseas`) removes this
completely; it does not fix the forced-lot overseas dead end (that gets tighter).

**Shared logic:** the reducer and the UI/CPU both call the same pure
`canBid(state, ctx, teamId, amount, at) -> BidRejectReason | null` (`at` is needed for
`LOT_EXPIRED`) and `nextBid(state)`, so a
disabled button and a rejected action always agree. Humans and CPUs submit the same
actions; the reducer never knows which is which.

**Forced-lot rule — min-squad guarantee (Decided).** The pool (180) is bigger than the
required squads (10 x 15 = 150), so unsold lots are allowed, but never so many that a
team ends below `squad.min`. Define, from state only (no new fields):
- `needed` = sum over teams of `max(0, squad.min - squadSize)`
- `left` = lots still to sell, *including* the open lot
- `slack = left - needed` (invariant: `slack >= 0`)

When `slack == 0` the open lot is **forced** (and so is every later lot):
- **Only needy teams (squad below min) may bid.** Others get `QUOTA_MET`; otherwise a
  sale to a full team would leave `left < needed`.
- **No passing** (`FORCED_LOT`), so the lot cannot close unsold or early-unsold.
- **If the timer expires with no bid**, the lot is assigned at **base price** to one
  needy team that can legally take it (affordable with reserve intact, overseas cap
  respected). The pick is a pure seeded derivation, `hash(seed, lotIndex) mod n`
  over the eligible teams in `teamOrder`; the record gets `assignedBy: forced`.
- A normal bid still wins normally (only needy teams can have bid).
- The UI shows a warning when the lot is forced (selector `squadPressure(state)` ->
  `{needed, left, slack, forced}`); an earlier heads-up at `slack <= 3` is optional.
- CPUs must bid on forced lots if they are needy (CPU view exposes `forced`).

Why the invariant holds: a sale to a needy team lowers `left` and `needed` by 1; a sale or
unsold at `slack > 0` lowers `slack` by at most 1; at `slack == 0` only needy sales are
possible. `START` already guarantees `slack >= 0` (pool >= teams x min).

**KNOWN HOLE (found 2026-10-17 by the random-play simulation, UNRESOLVED).** The
guarantee covers *how many* lots are left, not *which* lots. If a forced lot is an
overseas player and every team still short of the minimum is already at
`squad.maxOverseas`, nobody may legally take it: the lot closes unsold, `slack` goes to
-1 and some team ends below `squad.min`. In 150 simulated games it happened in 2-7 of
every 30, and **every** dead end among those moderate random bidders had this cause. It
is reproduced by the `it.fails` test "KNOWN ISSUE" in `engine/tests/forced.test.ts`;
remove the wrapper when fixed.

**Second variant: money (found later the same day, with extreme CPUs).** I first wrote
that purse was never the blocker; that held only for moderate bidders. CPUs that bid on
everything with no price limit spend almost the whole purse on the first ~55 lots (the
marquee and A tiers). The reserve rule protects only the cheapest base price (20) per open
slot, so when forced mode begins while tier A/B lots (base 100 / 50) are still coming,
needy teams hold exactly their reserve and cannot afford them: the lot goes unsold, slack
goes negative, teams end with 7-10 players (seed 1, always-bid profiles). A human who
overspends early can do the same. Reproduced by the `it.fails` test in
`engine/tests/sim.test.ts`. Same family as the overseas variant: the guarantee counts
lots, not whether the remaining lots are placeable. The "keep minimum squads reachable"
idea (option 1 below) would have to cover purse as well as the overseas cap.

Why it is deeper than the overseas cap alone: a needy team's overseas room is
`maxOverseas - overseasCount`, and the remaining lots must be placeable. With
`R_i` Indian lots left, `D` slots needed and `cap_o = sum over needy teams of
min(d_team, overseas room)`, the minimum squads are reachable iff `D <= R_i + cap_o`.
The slack rule (`left >= needed`) is only the special case where overseas room is ample.

**Related rules inconsistency (also found while tracing this).** A legal lineup needs
`lineup.size - lineup.maxOverseas` = 8 home players, but a minimum squad (15) with the
squad overseas cap (8) can hold only 7. Such a team could never field a legal 12.
Needs `squad.min - squad.maxOverseas >= lineup.size - lineup.maxOverseas`, which the
rules loader does not check yet and the current `rules.default.json` violates.

Options being weighed: (1) generalise the forced rule and bid legality to "keep the
minimum squads reachable", including the overseas cap (principled; one new reject code);
(2) let forced assignment ignore the overseas cap (cheap; squads may exceed it, and
lineups need separate handling); (3) shape the pool to limit overseas supply and accept
rare failures (no guarantee).

"No randomness in the reducer" means **no external RNG**. Seeded pure derivations from
`state.seed` are allowed (pool build, forced assignment).

### 4.6 Type sketch (reference for the code; Ayush writes the real files)

Sketch status: agreed as the starting point, still open to change while coding.
First implementation (Claude, for Ayush's review, 2026-10-16): `engine/src/constants.ts`
and `engine/src/types/*`. Differences from the sketch below: everything is `readonly`,
the closed value sets live in `constants.ts` with types derived from them, `GameId` and
`SquadPressure` are named types, and `BID_REJECT_REASONS` (the subset `canBid` returns)
is defined next to `REJECT_REASONS`. Code wins where this block disagrees.
Mirrors 4.1–4.5. Where this block and those sections disagree, fix whichever is wrong.

```ts
// ───── primitives ─────
type PlayerId = string;       // "p001"… permanent, never reused
type TeamId = string;
type ParticipantId = string;  // opaque (accounts vs guests decided in M4)
type Lakhs = number;          // integer, never a float
type Millis = number;         // epoch ms, always injected, never read inside the engine

// ───── player (data, not state) ─────
type AuctionTier = "marquee" | "A" | "B" | "C";
type PlayerType  = "bat" | "bowl" | "all-rounder";
type Hand        = "L" | "R";
type BatType     = "opener" | "middle" | "anchor" | "finisher";
type BowlType    = "pace" | "offSpin" | "legSpin" | "leftArmOrthodox" | "chinaman";
type BowlPhase   = "powerplay" | "middle" | "death";

interface Player {
  id: PlayerId; name: string; displayName: string;
  nationality: string;               // overseas = nationality !== rules.homeCountry
  auctionTier: AuctionTier;
  type: PlayerType; isKeeper: boolean; battingHand: Hand;
  batType: BatType | null;           // non-null iff batScore > 20
  bowlType: BowlType | null;         // non-null iff bowlScore > 20
  bowlingArm: Hand | null;
  bowlPhases: BowlPhase[];
  batScore: number; bowlScore: number; fieldScore: number; brandAppeal: number; // 0–100
}
interface Dataset { datasetVersion: number; players: Player[] }

// ───── rules ─────
interface IncrementBand { upTo: Lakhs | null; step: Lakhs }   // exactly one null, last
interface RuleSet {
  rulesVersion: number; currency: "lakhs"; homeCountry: string;
  teams: number; purse: Lakhs;
  squad:  { min: number; max: number; maxOverseas: number };
  lineup: { size: number; maxOverseas: number };
  pool: { selection: "stratified-seeded"; composition: Record<AuctionTier, number> };
  tierBasePrice: Record<AuctionTier, Lakhs>;
  tierOrder: AuctionTier[];
  lotOrder: "by-tier-then-shuffle";
  increments: IncrementBand[];
  timer: { bidWindowMs: number; resetOnBid: boolean };
}

// ───── state ─────
type Phase = "SETUP" | "LOT_OPEN" | "BETWEEN_LOTS" | "SELECTING" | "FINISHED";

interface SquadEntry { playerId: PlayerId; price: Lakhs; lotIndex: number }
interface Team {
  id: TeamId; name: string; kind: "human" | "cpu"; profileId: string | null;
  purse: Lakhs; squad: SquadEntry[]; lineup: PlayerId[] | null;
}
interface HighBid { teamId: TeamId; amount: Lakhs }
interface Lot {
  playerId: PlayerId; basePrice: Lakhs;
  highBid: HighBid | null; deadline: Millis; passed: TeamId[];
}
type LotRecord = { playerId: PlayerId; basePrice: Lakhs; closedAt: Millis } & (
  | { outcome: "unsold" }
  | { outcome: "sold"; teamId: TeamId; price: Lakhs; assignedBy: "bid" | "forced" }
);

interface GameMeta {
  gameId: string; mode: "offline" | "online";
  createdAt: Millis; startedAt: Millis | null; finishedAt: Millis | null;
  hostId: ParticipantId | null;
}
interface AuctionState {
  schemaVersion: number; revision: number;
  meta: GameMeta; datasetVersion: number; rules: RuleSet; seed: number | null; // null until START
  phase: Phase;
  teams: Record<TeamId, Team>; teamOrder: TeamId[];
  seats: Record<TeamId, ParticipantId | null>;
  lots: PlayerId[]; lotIndex: number; lot: Lot | null;
  unsold: PlayerId[]; history: LotRecord[];
  lastActionAt: Millis;
}

// ───── actions ─────
interface TeamSetup {
  id: TeamId; name: string; kind: "human" | "cpu";
  profileId: string | null; participantId: ParticipantId | null;
}
type Action =
  | { type: "START"; at: Millis; seed: number; teams: TeamSetup[] }
  | { type: "NEXT_LOT"; at: Millis }
  | { type: "BID"; at: Millis; teamId: TeamId; amount: Lakhs }
  | { type: "PASS"; at: Millis; teamId: TeamId }
  | { type: "TICK"; at: Millis }
  | { type: "SUBMIT_LINEUP"; at: Millis; teamId: TeamId; playerIds: PlayerId[] };

type RejectReason =
  | "WRONG_PHASE" | "TIME_WENT_BACKWARDS" | "UNKNOWN_TEAM"
  | "TEAM_COUNT_MISMATCH" | "INVALID_TEAMS" | "POOL_TOO_SMALL" | "DATASET_MISMATCH" // START
  | "LOT_EXPIRED" | "HAS_PASSED" | "QUOTA_MET" | "ALREADY_HIGHEST"           // BID
  | "STALE_AMOUNT" | "INSUFFICIENT_PURSE" | "RESERVE_VIOLATION"
  | "SQUAD_FULL" | "OVERSEAS_CAP"
  | "ALREADY_PASSED" | "HIGH_BIDDER_CANNOT_PASS" | "FORCED_LOT"             // PASS
  | "WRONG_LINEUP_SIZE" | "DUPLICATE_PLAYER"                                  // SUBMIT_LINEUP
  | "PLAYER_NOT_IN_SQUAD" | "LINEUP_OVERSEAS_CAP";

// ───── engine surface ─────
interface Ctx { datasetVersion: number; players: ReadonlyMap<PlayerId, Player> }   // not part of state
interface ReduceResult { state: AuctionState; error: RejectReason | null }

declare function reduce(ctx: Ctx, state: AuctionState, action: Action): ReduceResult;
declare function nextBid(state: AuctionState): Lakhs | null;
declare function canBid(state: AuctionState, ctx: Ctx, teamId: TeamId, amount: Lakhs, at: Millis): BidRejectReason | null;
declare function squadPressure(state: AuctionState): { needed: number; left: number; slack: number; forced: boolean };
```

**Notes on the sketch**
- Everything in `AuctionState` is JSON-safe: no `Map`, `Set`, `Date` or `undefined`, only
  `Record`, arrays and `null`. `Ctx.players` is a `Map` because it is not state.
- `LotRecord` is a discriminated union so a sold record always has team and price.
- `seed` is `number | null` because the state exists in `SETUP` before `START`.
- `seats` is built at `START` from each `TeamSetup.participantId`.
- Define tier/type/phase names as `as const` arrays too, with the union types derived from
  them, so the loader's runtime list and the types cannot drift apart.
- `canBid` should return a narrowed subset of `RejectReason` (bid-related codes only).

---

### 4.7 CPU, views and the headless driver (Implemented, M1 random baseline)

- **`viewFor(state, viewer)`** (`engine/src/engine/view.ts`): pure projection with the
  same shape as the state. Hides the seed and, during SELECTING, every other team's
  lineup (`viewer = null` hides all). Everything else is public, including every squad,
  purse and the upcoming lot order. The CPU and, online, every client only get views.
- **`decide(ctx, view, teamId, profile, rng, at) -> Action | null`**
  (`engine/src/cpu/decide.ts`): returns an ordinary BID/PASS or null (keep waiting).
  Bids always go through `canBid`, so it never proposes an illegal bid. Random baseline:
  per-lot price ceiling = base x (1 + `ceilingFactor` x a stable random 0..1), bids with
  `bidChance`, drops out with `passChance`, steps aside when it cannot afford the next
  bid (which lets lots close early), and never tries to pass on a forced lot (ignores the
  ceiling there). M3 replaces the body and adds profile fields; the contract stays.
- **`chooseLineup` / `lineupAction`** (`engine/src/cpu/lineup.ts`): best legal XII by
  batScore + bowlScore + fieldScore, overseas only up to the lineup cap; always reaches
  `requiredLineupSize`.
- **`playAuction(options)`** (`engine/src/sim/playAuction.ts`): runs a whole game
  headlessly on a virtual clock (each CPU thinks 0.5-4 s, then decides; 1.5 s banner
  between lots) and returns `{ initial, state, actions }`. Same options give the same
  game; `replayActions(ctx, initial, actions)` rebuilds the final state exactly. Accepts
  an injectable `decide`, so tests (and M3) can swap or spy on the brain. This is also the
  M3 simulator. It throws if a CPU action is ever rejected, which flags CPU bugs at once.
- **`npm run play`** (`engine/scripts/play.ts`, run with `tsx`): prints a full auction,
  then a squad table, most expensive buys and warnings for the known holes. Team names are
  neutral (Falcons, Gladiators, ...) on purpose.
- **Measured (60 seeds, default random CPUs):** all 60 finish; 54 keep every invariant;
  6 hit the overseas dead end (a team below 15); 49 have at least one team that cannot
  field a full legal 12. One game takes about 30 ms.

---

## 4a. UI layout and state mapping (Decided, M1)

Desktop-style two-part screen. **Left is static**; only the right side has tabs.
Team identity in M1 is just initials derived from the team name (no `shortName`
field, no icons yet).

```
┌─────────────────────────┬────────────────────────────────────┐
│ LEFT (static)           │ RIGHT (tabs)                       │
│  Current lot + bid/pass │  [Teams] [Players] [Chat]          │
│  My team built so far   │   Teams:   one sub-tab per team    │
│  My team stats          │   Players: Sold / Unsold / Upcoming│
│                         │   Chat:    online chat + sold feed │
└─────────────────────────┴────────────────────────────────────┘
```

| UI element | Source |
| --- | --- |
| Current player card (name, role, tags, scores) | `lot.playerId` -> dataset lookup |
| Current bid, bidder, base price | `lot.highBid`, `lot.basePrice` |
| Countdown | `lot.deadline` minus `host.now()` |
| Bid / pass buttons, next bid amount, why a bid is blocked | selectors `nextBid`, `canBid` (reason codes) |
| My team built so far (players, prices) | `teams[me].squad` + dataset |
| My purse, squad count, slots left, overseas count, reserve | `teams[me]` + selectors |
| Team status bars (e.g. "batting powerhouse") | selector over squad; **design deferred** to implementation |
| Teams tab: one sub-tab per team (squad, purse) | `teams[*]` + dataset |
| Players > Sold | `history` where outcome = sold |
| Players > Unsold | `unsold` |
| Players > Upcoming | `lots` after `lotIndex` (upcoming order is **public**) |
| Chat: sold announcements | derived from `history` |
| Chat: player messages | separate channel, **not** in `AuctionState` (online only, M4) |

**Consequences for the schema**
- No live bid feed in M1, so no `bids` on `Lot`. `history` stores outcomes only.
- Team stats must work on a **partial squad** (`squadProfile(squad)`); final
  scoring with the playing 12 builds on it.
- Upcoming lots being public means the CPU's public view includes the future lot
  order. M3 CPU logic may plan around it.
- Decided: the lineup picker is a **Lineup tab** that appears on the right during
  `SELECTING` (and opens by itself).

### 4a.1 What is built (M1 UI, 2026-10-17)

`web/` (Vite + React). Run it with `npm run dev` (from the repo root).

| File | Role |
| --- | --- |
| `src/host/localHost.ts` | **`LocalHost`**: the offline host. Owns `Date.now`, timers and the CPU teams; exposes `getState`, `subscribe`, `dispatch`, `now` (the interface an online host will also provide), plus `setSpeed`, `dispose`. Drives lots (first lot after 1.5 s, 2.8 s result banner between lots), CPU think times (0.5-4 s) and CPU lineups. |
| `src/data.ts` | Loads the bundled JSON through the engine's validating loaders; fails loudly on bad data. |
| `src/lib/hooks.ts` | `useHostState` (`useSyncExternalStore`) and `useNow` (countdown tick). |
| `src/lib/squad.ts`, `format.ts` | Provisional squad read-outs (counts and four averaged bars), money/initials/labels, plain-English texts for reject codes. |
| `src/components/LeftPanel.tsx` | Static left half: the lot on the block (player card, bid, countdown, Bid/Pass), the result banner between lots, and **my team** (purse, slots, overseas, reserve, role mix, bars, roster). |
| `src/components/RightPanel.tsx` | Tabbed right half: **Teams** (one sub-tab per team), **Players** (Upcoming / Sold / Unsold), **Chat** (sold announcements; input disabled until online), **Lineup** (SELECTING only: checklist, live hints, Auto-pick, Submit). |
| `src/components/Setup.tsx`, `Results.tsx`, `App.tsx` | Setup (team name, optional seed), end-of-auction table, and the app shell ("Fast CPUs" toggle, "New game"). |

How it follows the design:
- The UI reads **`viewFor(state, me)`**, never the raw state, exactly as an online client will.
- Disabled buttons use the same pure checks the reducer uses (`canBid`, `passError`,
  `lineupError`), with the reject code turned into a sentence, so a button and a rejection
  cannot disagree.
- The human is team `t1` (kind `human`); the nine CPU teams use neutral names.
- The game ends (and the results screen shows) the moment the last lineup is submitted.

Tests: `web/src/host/localHost.test.ts` (host on a fake clock, incl. a whole auction to
FINISHED) and `web/src/App.test.tsx` (the real React app in jsdom: setup, bidding, passing,
tabs, privacy of rivals' lineups, a full game to the results table). 13 deliberate UI/host
bugs were all caught (2 needed new tests first). **Not yet checked in a real browser**: the
Chrome extension was not connected, so layout and look are unreviewed; please open it and
tell me what is off.

Known limits: the results screen shows **provisional averages**, not the real scoring
(strength by aspect, balance, brand, bench are still to be designed); team badges are
initials only; no sound, animation or mobile polish beyond a single-column fallback below
900 px; no save/resume yet (state is JSON-safe, so IndexedDB is straightforward).

---

## 5. Features

### Core (engine)
- [ ] Auction state machine
- [ ] Bidding rules (increments, validity, purse limits)
- [ ] Lot progression (sold / unsold)
- [ ] Squad composition constraints
- [ ] Scoring: brand appeal
- [ ] Scoring: performance

### Later
- [ ] CPU bidding strategies
- [ ] Multiplayer (human vs human)
- [ ] UI / hosts
- [ ] Player dataset sourcing

---

## 6. Decision log

| Date | Decision | Notes |
| --- | --- | --- |
| 2026-10-16 | Engine is a pure state machine | Time + randomness injected |
| 2026-10-16 | Engine is platform-agnostic | One engine, three hosts |
| 2026-10-16 | Milestones: M1 offline 1 human + 7 random CPU, M2 host-set rules, M3 rational CPU, M4 online room | RuleSet and CPU `decide()` exist from M1; host interface (`dispatch/subscribe/now`) so UI is reusable online |
| 2026-10-16 | Data is static JSON in `data/`, not a DB or Excel | Spreadsheet/CSV only as an authoring step later |
| 2026-10-16 | Player model finalised (section 4.1) | Includes `auctionTier`; base price comes from rules, not the player |
| 2026-10-16 | Each team picks a playing 12 at the end; strength from the 12, bench strength tracked separately | Squad min >= 12; dataset needs ~100–120 players |
| 2026-10-16 | Dataset starts at 300 active IPL players (appeared 2024+), ranked from Cricsheet; each game draws a smaller auction pool (`poolSize`, seeded sample by tier) | Pool rules still to add to `RuleSet` |
| 2026-10-16 | `data/players.v1.json` drafted by Claude (exception to "Ayush writes all the code" for this data file only) | All values are judgement; see `data/players-review-notes.md`; Ayush reviews |
| 2026-10-16 | `rules.default.json` settled: 10 teams, purse 2500, squad 15–25, pool 180 (12/24/40/104) | Lineup keeper/bowling minimums are soft (balance score), not hard rules |
| 2026-10-16 | `AuctionState` finalised (section 4.3): complete snapshot, same schema offline and on the server; squads and bid trails (`history`) live in state; `revision` per action; facts not computations | Passing supported; explicit `NEXT_LOT`; `viewFor` projection for hidden info |
| 2026-10-16 | **Reverses the bid-trail decision above:** `history` stores outcomes only; no per-lot bid/pass trails | Not needed; add later with a schema bump if a feature requires it |
| 2026-10-16 | M1 UI: static left (current lot, my team, my stats), tabbed right (Teams per-team, Players sold/unsold/upcoming, Chat); upcoming lots public; team identity = initials | See section 4a |
| 2026-10-16 | Actions drafted (section 4.5): `reduce` returns `{state, error}`; BID carries an amount that must equal `nextBid`; early lot close when no contender; lineup picker is a right-side tab in SELECTING; phase LOT_RESULT renamed BETWEEN_LOTS | Min-squad guarantee still open |
| 2026-10-16 | Min-squad guarantee = forced-lot rule: when lots left == slots needed, only needy teams may bid, no passing, and an unbid lot goes at base price to a seeded-random eligible needy team | No second round needed; invariant `slack >= 0`; see 4.5 |
| 2026-10-16 | Type sketch recorded in section 4.6 as the reference for the code | State is JSON-safe; `LotRecord` is a discriminated union; `seed` null until START |
| 2026-10-16 | Repo is an npm-workspaces monorepo: `engine/` (renamed from `Game Engine/`), `web/` (Vite + React + TS), shared `data/`; Node upgraded to 22 via fnm, tooling current (Vite 8, Vitest 4) | Claude created the scaffold/config at Ayush's request (second exception to "Ayush writes all the code"); see 3.2b |
| 2026-10-17 | **M1 UI built** (section 4a.1): `LocalHost`, setup screen, static left panel (lot, my team), tabbed right panel (Teams / Players / Chat / Lineup), results table; added shared `passError` to the engine so the Pass button and the reducer agree; web tests on a fake clock and in jsdom (22), engine 228 + 2 expected-fail | Tooling: Vitest + jsdom + React Testing Library in `web/`; not verified in a real browser (extension not connected) |
| 2026-10-17 | Random-bid CPU, `viewFor`, headless driver `playAuction` + `replayActions`, and the text-mode script `npm run play` implemented (section 4.7); 14 deliberate bugs in this layer, all caught (2 needed new tests first); 228 tests + 2 expected-fail | **Second dead end found:** free-spending CPUs run teams out of money before the A/B-tier lots, so forced lots go unsold (money variant of the known hole); earlier claim "purse was never the blocker" corrected |
| 2026-10-17 | `SUBMIT_LINEUP` implemented (`lineupError`, `submitLineup`, `requiredLineupSize`): all six actions now exist and a whole game runs START to FINISHED in the engine; invariants cover lineups; 10 deliberate bugs all caught; 182 tests + 1 expected-fail | Engine decision: required lineup size falls back to what the squad can legally field, so a game always finishes. Measured: 26-28 of 30 random auctions leave a team unable to field a full 12 |
| 2026-10-17 | **Deferred by Ayush:** the overseas-cap hole in the forced-lot guarantee and the squad-vs-lineup overseas inconsistency are left as they are for now ("we will enforce the rule later") | Revisit before the CPU work (M3) or whenever a game must be guaranteed to finish with legal squads; the `it.fails` test marks it. Until then a team can occasionally end below 15, or with too few home players for a legal 12 |
| 2026-10-17 | `PASS`, early close (no contender), and the forced-lot rule implemented (`settleLot`, `holdError`, `hasContender`); invariants now also assert `slack >= 0` and minimum squads after bidding; random sim fires blind legal/illegal actions; 12 more deliberate bugs, all caught | **Found a hole** the guarantee does not cover: overseas cap blocks a forced lot (2-7 of 30 random games), plus a rules inconsistency (squad overseas cap vs lineup); left open, see 4.5 "KNOWN HOLE"; 163 tests + 1 expected-fail |
| 2026-10-17 | `NEXT_LOT`, `BID`, `TICK` (closes the lot) implemented with selectors `nextBid`, `incrementAt`, `squadPressure`, `canBid` (incl. reserve rule, overseas cap, `QUOTA_MET`) and a shared `closeLot`; test infrastructure: `fixtures`, `invariants` (money, squads, history, reserve) checked after every action of a random-bidding simulation; mutation check (10 deliberate bugs, all caught) | `PASS`, early close, forced-lot assignment, `SUBMIT_LINEUP` still to do; 129 tests |
| 2026-10-17 | Engine built so far: constants, types, dataset/rules loaders + cross-check, seeded RNG (`random.ts`), `createGame`/`createCtx`, `START` in `reduce` (other actions throw "not implemented"); 90 tests pass | Added reject code `INVALID_TEAMS`; `Ctx` gained `datasetVersion` |
| 2026-10-16 | Offline play is fully client-side; backend only for online authority (engine, clock, RNG, CPU seats, rooms) | See section 3.2a |
| 2026-10-16 | Player ids are permanent; gaps allowed, never reused or renumbered | 11 inactive players removed from `players.v1.json` (289 remain) |
| 2026-10-16 | CPU lives outside the reducer, emits ordinary BID actions, sees only a public view | Replayable; same code runs server-side in M4 |
