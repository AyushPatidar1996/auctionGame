/** Loaders never throw on bad data; they return every problem they found. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(errors: readonly string[]): Result<never> {
  return { ok: false, errors };
}
