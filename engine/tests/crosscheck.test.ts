import { describe, expect, it } from "vitest";
import { checkRulesAgainstDataset, loadDataset, loadRules } from "../src/loaders";
import type { Dataset, RuleSet } from "../src/types";
import { readData } from "./helpers";

function loadReal(): { rules: RuleSet; dataset: Dataset } {
  const rules = loadRules(readData("rules.default.json"));
  const dataset = loadDataset(readData("players.v1.json"));
  if (!rules.ok) throw new Error(rules.errors.join("\n"));
  if (!dataset.ok) throw new Error(dataset.errors.join("\n"));
  return { rules: rules.value, dataset: dataset.value };
}

describe("checkRulesAgainstDataset", () => {
  it("the real rules and dataset agree", () => {
    const { rules, dataset } = loadReal();
    expect(checkRulesAgainstDataset(rules, dataset)).toEqual({ errors: [], warnings: [] });
  });

  it("errors when a tier asks for more players than the dataset has", () => {
    const { rules, dataset } = loadReal();
    const tooMany: RuleSet = {
      ...rules,
      pool: { ...rules.pool, composition: { ...rules.pool.composition, marquee: 999 } },
    };
    const { errors } = checkRulesAgainstDataset(tooMany, dataset);
    expect(errors.join("\n")).toContain("pool.composition.marquee is 999");
  });

  it("warns when nobody is a home-country player", () => {
    const { rules, dataset } = loadReal();
    const { errors, warnings } = checkRulesAgainstDataset(
      { ...rules, homeCountry: "Atlantis" },
      dataset,
    );
    expect(errors).toEqual([]);
    expect(warnings.join("\n")).toContain('"Atlantis"');
  });
});
