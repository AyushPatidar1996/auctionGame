import { readFileSync } from "node:fs";
import { expect } from "vitest";
import type { Result } from "../src/loaders";

// Tests may touch the disk; src/ never does.
export function readData(fileName: string): unknown {
  const url = new URL(`../../data/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

/** Loose JSON shape for building deliberately broken copies. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Raw = any;

export function cloneRaw(name: string): Raw {
  return structuredClone(readData(name));
}

/** Asserts a failed Result and that some error mentions `fragment`. */
export function expectError(result: Result<unknown>, fragment: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const joined = result.errors.join("\n");
  expect(joined, `errors were:\n${joined}`).toContain(fragment);
}
