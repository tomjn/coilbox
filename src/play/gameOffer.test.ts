import { describe, expect, it } from "vitest";
import type { SuggestedGame } from "../content/branding";
import type { InstalledContentSnapshot } from "../content/resolveContent";
import type { GameRepo } from "../downloads/gameRepos";
import {
  distinctGames,
  type GameCatalog,
  gameRequirement,
  offerableGames,
  resolveGameDownload,
} from "./gameOffer";

const repos: GameRepo[] = [
  {
    key: "splinterfaction",
    label: "SplinterFaction",
    repo: "SplinterFaction/SplinterFaction",
    nameKey: "splinterfaction",
  },
];

const suggested: SuggestedGame[] = [
  {
    id: "mcl",
    title: "MechCommander: Legacy",
    entryId: "mechcommander-legacy",
    download: { kind: "rapid", tag: "mcl:test" },
  },
  {
    id: "splinter-faction",
    title: "SplinterFaction",
    entryId: "splinter-faction",
    download: { kind: "github", sourceKey: "splinterfaction" },
  },
  {
    id: "xta",
    title: "XTA",
    entryId: "xta",
    download: {
      kind: "url",
      url: "https://example.test/xta.sdz",
      filename: "x",
    },
  },
];

function catalog(over: Partial<GameCatalog> = {}): GameCatalog {
  return {
    entries: [
      {
        id: "mechcommander-legacy",
        match: { regex: "^MechCommander:? *Legacy", names: ["MCL"] },
      },
      {
        id: "splinter-faction",
        match: { regex: "^Splinter *Faction" },
        compiledRegex: /^Splinter *Faction/i,
      },
      { id: "xta", match: { names: ["XTA"] } },
      { id: "no-suggestion", match: { names: ["Orphan"] } },
    ],
    suggested,
    repos,
    newestArchive: () => "SplinterFaction_0.1.86.sdz",
    ...over,
  };
}

describe("resolveGameDownload", () => {
  it("downloads a pinned build by its exact archive name", () => {
    expect(
      resolveGameDownload(
        { shortname: "anything", pinnedName: "Some Game 1.2.3" },
        catalog({ entries: [], suggested: [] }),
      ),
    ).toEqual({ label: "Some Game 1.2.3", downloadKey: "Some Game 1.2.3" });
  });

  it("uses the rapid tag of the catalog game the shortname matches", () => {
    expect(resolveGameDownload({ shortname: "mcl" }, catalog())).toEqual({
      label: "MechCommander: Legacy",
      downloadKey: "mcl:test",
    });
  });

  it("names the newest GitHub release archive without its extension", () => {
    expect(
      resolveGameDownload({ shortname: "SplinterFaction" }, catalog()),
    ).toEqual({
      label: "SplinterFaction",
      downloadKey: "SplinterFaction_0.1.86",
    });
  });

  it("asks the release lookup about the repo the source key names", () => {
    const asked: string[] = [];
    resolveGameDownload(
      { shortname: "SplinterFaction" },
      catalog({
        newestArchive: (repo) => {
          asked.push(repo);
          return undefined;
        },
      }),
    );
    expect(asked).toEqual(["SplinterFaction/SplinterFaction"]);
  });

  it("offers nothing while the newest release is unknown", () => {
    expect(
      resolveGameDownload(
        { shortname: "SplinterFaction" },
        catalog({ newestArchive: () => undefined }),
      ),
    ).toBeNull();
  });

  it("offers nothing for a source key the registry does not hold", () => {
    expect(
      resolveGameDownload(
        { shortname: "SplinterFaction" },
        catalog({ repos: [] }),
      ),
    ).toBeNull();
  });

  it("offers nothing for a shortname no catalog entry matches", () => {
    expect(resolveGameDownload({ shortname: "unknown" }, catalog())).toBeNull();
  });

  it("offers nothing when the matching entry has no downloadable game", () => {
    expect(resolveGameDownload({ shortname: "Orphan" }, catalog())).toBeNull();
  });

  it("offers nothing for a direct file download, which has no game name", () => {
    expect(resolveGameDownload({ shortname: "XTA" }, catalog())).toBeNull();
  });
});

describe("distinctGames", () => {
  it("keeps one game per shortname, ignoring case", () => {
    expect(
      distinctGames([
        { shortname: "SF" },
        { shortname: "sf" },
        { shortname: "MCL" },
      ]),
    ).toEqual([{ shortname: "SF" }, { shortname: "MCL" }]);
  });

  it("keeps a pinned build apart from the unpinned game", () => {
    expect(
      distinctGames([
        { shortname: "SF" },
        { shortname: "SF", pinnedName: "SF 1" },
        { shortname: "SF", pinnedName: "SF 1" },
      ]),
    ).toEqual([{ shortname: "SF" }, { shortname: "SF", pinnedName: "SF 1" }]);
  });
});

describe("offerableGames", () => {
  it("keeps only the games a download can be named for", () => {
    const offers = offerableGames(
      [{ shortname: "mcl" }, { shortname: "unknown" }, { shortname: "MCL" }],
      catalog(),
    );
    expect(offers).toEqual([
      {
        game: { shortname: "mcl" },
        download: { label: "MechCommander: Legacy", downloadKey: "mcl:test" },
      },
    ]);
  });
});

describe("gameRequirement", () => {
  const none: InstalledContentSnapshot = {
    games: [],
    maps: [],
    engineVersions: [],
  };

  it("carries the download name and label", () => {
    const req = gameRequirement(
      { shortname: "mcl" },
      { label: "MechCommander: Legacy", downloadKey: "mcl:test" },
    );
    expect(req.kind).toBe("game");
    expect(req.label).toBe("MechCommander: Legacy");
    expect(req.downloadKey).toBe("mcl:test");
  });

  it("is met by any installed version of the shortname, not the download name", () => {
    const req = gameRequirement(
      { shortname: "SplinterFaction" },
      { label: "SplinterFaction", downloadKey: "SplinterFaction_0.1.86" },
    );
    expect(req.isInstalled(none)).toBe(false);
    expect(
      req.isInstalled({
        ...none,
        games: [
          {
            name: "SplinterFaction 0.1.70",
            shortname: "splinterfaction",
            version: "0.1.70",
          },
        ],
      }),
    ).toBe(true);
  });
});
