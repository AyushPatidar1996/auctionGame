import {
  BAT_TYPES,
  BOWL_PHASES,
  BOWL_TYPES,
  HANDS,
  PLAYER_TYPES,
  SCORE_MAX,
  SCORE_MIN,
  SKILL_THRESHOLD,
  TIERS,
  type BowlPhase,
} from "../constants";
import type { Dataset, Player } from "../types";
import {
  bool,
  checkKeys,
  inList,
  int,
  isObj,
  oneOf,
  oneOfOrNull,
  str,
  type Report,
} from "./guards";
import { fail, ok, type Result } from "./result";

const ID_PATTERN = /^p\d{3,}$/;
const DATASET_KEYS = ["datasetVersion", "players"];
const PLAYER_KEYS = [
  "id", "name", "displayName", "nationality", "auctionTier", "type", "isKeeper",
  "battingHand", "batType", "bowlType", "bowlingArm", "bowlPhases",
  "batScore", "bowlScore", "fieldScore", "brandAppeal",
];

/** Validates already-parsed JSON (no file I/O in the engine) and collects every error. */
export function loadDataset(raw: unknown): Result<Dataset> {
  if (!isObj(raw)) return fail(["dataset: expected an object"]);
  const errors: string[] = [];
  const report: Report = (m) => errors.push(`dataset: ${m}`);

  checkKeys(raw, DATASET_KEYS, report);
  const datasetVersion = int(raw.datasetVersion, "datasetVersion", report, 1);

  if (!Array.isArray(raw.players) || raw.players.length === 0) {
    return fail([...errors, "dataset: players must be a non-empty array"]);
  }

  const players: Player[] = [];
  const seen = new Set<string>();
  raw.players.forEach((rawPlayer: unknown, index: number) => {
    const player = parsePlayer(rawPlayer, index, errors);
    if (!player) return;
    if (seen.has(player.id)) errors.push(`${player.id}: duplicate id`);
    seen.add(player.id);
    players.push(player);
  });

  for (const tier of TIERS) {
    if (!players.some((p) => p.auctionTier === tier)) {
      errors.push(`dataset: no player has auctionTier "${tier}"`);
    }
  }

  if (errors.length > 0 || datasetVersion === undefined) return fail(errors);
  return ok({ datasetVersion, players });
}

function parsePlayer(raw: unknown, index: number, errors: string[]): Player | null {
  if (!isObj(raw)) {
    errors.push(`players[${index}]: expected an object`);
    return null;
  }
  const before = errors.length;
  const label = typeof raw.id === "string" ? raw.id : `players[${index}]`;
  const report: Report = (m) => errors.push(`${label}: ${m}`);

  checkKeys(raw, PLAYER_KEYS, report);

  const id = str(raw.id, "id", report);
  if (id !== undefined && !ID_PATTERN.test(id)) report(`id must match ${ID_PATTERN}`);
  const name = str(raw.name, "name", report);
  const displayName = str(raw.displayName, "displayName", report);
  const nationality = str(raw.nationality, "nationality", report);
  const auctionTier = oneOf(TIERS, raw.auctionTier, "auctionTier", report);
  const type = oneOf(PLAYER_TYPES, raw.type, "type", report);
  const isKeeper = bool(raw.isKeeper, "isKeeper", report);
  const battingHand = oneOf(HANDS, raw.battingHand, "battingHand", report);
  const batType = oneOfOrNull(BAT_TYPES, raw.batType, "batType", report);
  const bowlType = oneOfOrNull(BOWL_TYPES, raw.bowlType, "bowlType", report);
  const bowlingArm = oneOfOrNull(HANDS, raw.bowlingArm, "bowlingArm", report);
  const bowlPhases = parsePhases(raw.bowlPhases, report);
  const batScore = int(raw.batScore, "batScore", report, SCORE_MIN, SCORE_MAX);
  const bowlScore = int(raw.bowlScore, "bowlScore", report, SCORE_MIN, SCORE_MAX);
  const fieldScore = int(raw.fieldScore, "fieldScore", report, SCORE_MIN, SCORE_MAX);
  const brandAppeal = int(raw.brandAppeal, "brandAppeal", report, SCORE_MIN, SCORE_MAX);

  // Cross-field rules (each runs only when the fields it needs parsed cleanly).
  if (batType !== undefined && batScore !== undefined) {
    if ((batType !== null) !== batScore > SKILL_THRESHOLD) {
      report(`batType is ${batType ?? "null"} but batScore is ${batScore}`);
    }
  }
  if (bowlType !== undefined && bowlScore !== undefined) {
    if ((bowlType !== null) !== bowlScore > SKILL_THRESHOLD) {
      report(`bowlType is ${bowlType ?? "null"} but bowlScore is ${bowlScore}`);
    }
  }
  if (bowlType !== undefined && bowlingArm !== undefined) {
    if ((bowlingArm !== null) !== (bowlType !== null)) {
      report("bowlingArm must be set exactly when bowlType is set");
    }
  }
  if (bowlType !== undefined && bowlPhases !== undefined) {
    if ((bowlPhases.length > 0) !== (bowlType !== null)) {
      report("bowlPhases must be non-empty exactly when bowlType is set");
    }
  }
  if (type !== undefined && batType !== undefined && bowlType !== undefined) {
    if ((type === "bat" || type === "all-rounder") && batType === null) {
      report(`type ${type} requires a batType`);
    }
    if ((type === "bowl" || type === "all-rounder") && bowlType === null) {
      report(`type ${type} requires a bowlType`);
    }
  }

  if (errors.length > before) return null;
  if (
    id === undefined || name === undefined || displayName === undefined ||
    nationality === undefined || auctionTier === undefined || type === undefined ||
    isKeeper === undefined || battingHand === undefined || batType === undefined ||
    bowlType === undefined || bowlingArm === undefined || bowlPhases === undefined ||
    batScore === undefined || bowlScore === undefined || fieldScore === undefined ||
    brandAppeal === undefined
  ) {
    return null;
  }
  return {
    id, name, displayName, nationality, auctionTier, type, isKeeper, battingHand,
    batType, bowlType, bowlingArm, bowlPhases,
    batScore, bowlScore, fieldScore, brandAppeal,
  };
}

function parsePhases(v: unknown, report: Report): readonly BowlPhase[] | undefined {
  if (!Array.isArray(v)) {
    report("bowlPhases must be an array");
    return undefined;
  }
  const phases: BowlPhase[] = [];
  for (const item of v) {
    if (!inList(BOWL_PHASES, item)) {
      report(`bowlPhases has an invalid entry (allowed: ${BOWL_PHASES.join(", ")})`);
      return undefined;
    }
    if (phases.includes(item)) {
      report(`bowlPhases lists "${item}" twice`);
      return undefined;
    }
    phases.push(item);
  }
  return phases;
}
