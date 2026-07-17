import { describe, expect, it } from "vitest";
import type { BrandingEntry, SuggestedGame } from "./branding";
import { filterSuggestedGamesByFilter } from "./suggestedGames";

const sf: SuggestedGame = {
  id: "splinter-faction",
  title: "SplinterFaction",
  entryId: "splinter-faction",
  download: { kind: "github", repo: "example/sf" },
};
const mf: SuggestedGame = {
  id: "metal-factions",
  title: "Metal Factions",
  entryId: "metal-factions",
  download: { kind: "rapid", tag: "mf:stable" },
};

const entries: BrandingEntry[] = [
  { id: "splinter-faction", match: { regex: "^Splinter *Faction" } },
  { id: "metal-factions", match: { names: ["Metal Factions"] } },
];

// The matcher is a black box to this helper (its type is `(name) => boolean`), so
// the tests inject plain predicates rather than importing profile's makeGameMatcher
// (which lives behind a plugin-command import and isn't unit-loadable here).
describe("filterSuggestedGamesByFilter", () => {
  it("keeps every suggestion when there is no gameFilter", () => {
    expect(filterSuggestedGamesByFilter([sf, mf], entries, null)).toEqual([
      sf,
      mf,
    ]);
  });

  it("narrows via a match on the suggestion title", () => {
    const out = filterSuggestedGamesByFilter([sf, mf], entries, (n) =>
      /^splinter/i.test(n),
    );
    expect(out).toEqual([sf]);
  });

  it("matches the branding entry's canonical names, not just the title", () => {
    const out = filterSuggestedGamesByFilter(
      [sf, mf],
      entries,
      (n) => n.toLowerCase() === "metal factions",
    );
    expect(out).toEqual([mf]);
  });

  it("drops a suggestion whose title and entry names both miss", () => {
    const out = filterSuggestedGamesByFilter([sf, mf], entries, () => false);
    expect(out).toEqual([]);
  });

  it("still checks the title when the suggestion has no entryId", () => {
    const orphan: SuggestedGame = {
      id: "x",
      title: "SplinterFaction",
      download: { kind: "github", repo: "example/x" },
    };
    const out = filterSuggestedGamesByFilter([orphan], entries, (n) =>
      /^splinter/i.test(n),
    );
    expect(out).toEqual([orphan]);
  });
});
