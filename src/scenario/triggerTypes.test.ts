/**
 * `TYPE_GROUPS`, the band each condition and action sits under in the add-step
 * dropdown (issue #2273). Pinned as plain data so a condition or action added
 * to `CONDITION_TYPES` or `ACTION_TYPES` without a matching band here fails a
 * fast test instead of silently vanishing from the grouped dropdown, the same
 * failure mode `TYPE_DESCRIPTIONS` already guards against for descriptions.
 */

import { describe, expect, it } from "vitest";
import {
  ACTION_GROUP_ORDER,
  ACTION_TYPES,
  CONDITION_GROUP_ORDER,
  CONDITION_TYPES,
  TYPE_GROUPS,
} from "./triggerTypes";

describe("TYPE_GROUPS", () => {
  it("bands every action exactly once, into a band the actions list actually offers", () => {
    const actionTypes = Object.keys(ACTION_TYPES);
    for (const type of actionTypes) {
      const group = TYPE_GROUPS[type];
      expect(group, `${type} has no band`).toBeDefined();
      expect(
        (ACTION_GROUP_ORDER as readonly string[]).includes(group as string),
        `${type}'s band "${group}" is not offered for actions`,
      ).toBe(true);
    }
  });

  it("bands every condition exactly once, into a band the conditions list actually offers", () => {
    const conditionTypes = Object.keys(CONDITION_TYPES);
    for (const type of conditionTypes) {
      const group = TYPE_GROUPS[type];
      expect(group, `${type} has no band`).toBeDefined();
      expect(
        (CONDITION_GROUP_ORDER as readonly string[]).includes(group as string),
        `${type}'s band "${group}" is not offered for conditions`,
      ).toBe(true);
    }
  });

  it("has no entry for a type neither table declares", () => {
    const known = new Set([
      ...Object.keys(CONDITION_TYPES),
      ...Object.keys(ACTION_TYPES),
    ]);
    for (const type of Object.keys(TYPE_GROUPS)) {
      expect(known.has(type), `${type} is not a condition or action`).toBe(
        true,
      );
    }
  });
});
