/**
 * What a morph edge says it takes, split into the one entry coilbox writes
 * itself and the rest.
 *
 * An edge with `evolves: true` is Beyond All Reason's evolution, where the unit
 * changes with no order given (#2152). That is a fact to put in words. Every
 * other key is whatever the game wrote (`energy`, `time`, `cmdname` and others),
 * so those stay as the game's own key and value.
 */
export function splitMorphConditions(conditions: [string, unknown][]): {
  evolves: boolean;
  rest: [string, unknown][];
} {
  const isEvolution = ([key, value]: [string, unknown]) =>
    key === "evolves" && value === true;
  return {
    evolves: conditions.some(isEvolution),
    rest: conditions.filter((entry) => !isEvolution(entry)),
  };
}
