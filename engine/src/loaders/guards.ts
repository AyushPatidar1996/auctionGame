// Small field parsers for loaders. Convention: a parser reports its own problem
// through `report` and returns `undefined` on failure. A valid JSON `null`
// comes back as `null` (nullable parsers only). Callers check `=== undefined`.

export type Obj = Record<string, unknown>;
export type Report = (message: string) => void;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

export function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function inList<T extends string>(
  list: readonly T[],
  v: unknown,
): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Flags keys the schema does not know, which catches typos in hand-edited JSON. */
export function checkKeys(
  obj: Obj,
  allowed: readonly string[],
  report: Report,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) report(`unexpected field "${key}"`);
  }
}

export function str(v: unknown, field: string, report: Report): string | undefined {
  if (isStr(v)) return v;
  report(`${field} must be a non-empty string`);
  return undefined;
}

export function bool(v: unknown, field: string, report: Report): boolean | undefined {
  if (typeof v === "boolean") return v;
  report(`${field} must be true or false`);
  return undefined;
}

export function int(
  v: unknown,
  field: string,
  report: Report,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  if (isInt(v) && v >= min && v <= max) return v;
  const range = max === Number.MAX_SAFE_INTEGER ? `>= ${min}` : `${min}..${max}`;
  report(`${field} must be an integer ${range}`);
  return undefined;
}

export function oneOf<T extends string>(
  list: readonly T[],
  v: unknown,
  field: string,
  report: Report,
): T | undefined {
  if (inList(list, v)) return v;
  report(`${field} must be one of ${list.join(", ")}`);
  return undefined;
}

export function oneOfOrNull<T extends string>(
  list: readonly T[],
  v: unknown,
  field: string,
  report: Report,
): T | null | undefined {
  if (v === null) return null;
  return oneOf(list, v, field, report);
}
