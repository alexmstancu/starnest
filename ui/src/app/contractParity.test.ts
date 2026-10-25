// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { NumberRule } from "../format/typedNumber";
import { numberRulesFor } from "../routes/configure/criteria/criterionForm";
import { HOUSEHOLD_RULES } from "../routes/configure/household/householdForm";
import { SETTING_FIELDS } from "../routes/configure/settings/settingsForm";

/**
 * T28-2 (PL-028). **Each numeric field's bounds on screen are the contract's.** A field refuses
 * what it cannot send before anything is sent, so a bound the screen holds and the contract does
 * not (or the reverse) is a figure refused for no reason, or one sent only to be refused. The
 * backend's boundary walk holds the server to the same file, which keeps the three copies equal.
 */

const CONTRACT = parse(
  readFileSync(join(__dirname, "..", "..", "..", "docs", "openapi.yaml"), "utf8"),
) as { components: { schemas: Record<string, Schema> } };

interface Schema {
  type?: string | string[];
  minimum?: number;
  maximum?: number;
  properties?: Record<string, Schema>;
  items?: Schema;
}

interface Bounds {
  minimum?: number;
  maximum?: number;
  whole?: boolean;
}

function contractBounds(schema: Schema | undefined): Bounds {
  if (schema === undefined) throw new Error("the contract has no such field");
  const types = [schema.type ?? []].flat();
  return {
    ...(schema.minimum !== undefined && { minimum: schema.minimum }),
    ...(schema.maximum !== undefined && { maximum: schema.maximum }),
    whole: types.includes("integer"),
  };
}

function screenBounds(rule: NumberRule): Bounds {
  return {
    ...(rule.minimum !== undefined && { minimum: rule.minimum }),
    ...(rule.maximum !== undefined && { maximum: rule.maximum }),
    whole: rule.kind === "whole",
  };
}

const properties = (schema: string) => CONTRACT.components.schemas[schema]?.properties ?? {};

describe("a numeric field's bounds, against the contract", () => {
  it.each(SETTING_FIELDS.map((field) => [field.name, field.rule] as const))(
    "settings: %s",
    (name, rule) => {
      expect(screenBounds(rule)).toEqual(contractBounds(properties("SettingsInput")[name]));
    },
  );

  it.each(Object.entries(HOUSEHOLD_RULES))("household: %s", (name, rule) => {
    expect(screenBounds(rule)).toEqual(contractBounds(properties("HouseholdInput")[name]));
  });

  /**
   * The rule editor's figures are in the attribute's own unit, so whether they are whole depends
   * on the attribute and the contract types them `number`: only the bounds are compared.
   */
  describe("the rule editor", () => {
    const criterion = properties("CriterionInput");
    const anchor = criterion["scale_anchors"]?.items?.properties ?? {};
    const rules = numberRulesFor("decimal");
    const unbounded = ({ minimum, maximum }: Bounds) => ({ minimum, maximum });

    it.each(["target_range_min", "target_range_max", "zero_score_below", "zero_score_above"])(
      "%s",
      (name) => {
        expect(unbounded(screenBounds(rules.bound))).toEqual(
          unbounded(contractBounds(criterion[name])),
        );
      },
    );

    it("an anchor's figure", () => {
      expect(unbounded(screenBounds(rules.anchorValue))).toEqual(
        unbounded(contractBounds(anchor["input_value"])),
      );
    });

    /**
     * **A known gap, said rather than skipped.** The server refuses a score below zero
     * (`ScaleAnchor.score`, `ge=0`) and the contract does not yet state it, so the screen holds
     * the server's floor. When the contract gains `minimum: 0` this fails, and the exception goes.
     */
    it("an anchor's score: whole, with the server's floor the contract does not yet state", () => {
      expect(screenBounds(rules.anchorScore)).toEqual({ minimum: 0, whole: true });
      expect(contractBounds(anchor["score"])).toEqual({ whole: true });
    });
  });
});
