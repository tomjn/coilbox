import { describe, expect, it } from "vitest";
import { deriveHealthChecks, type HealthInputs } from "./health";

function base(): HealthInputs {
  return {
    portableRoot: "/pkg/.coilbox",
    profileSource: "file",
    profileError: null,
    profileErrorSnippet: null,
    gameFilter: undefined,
    roots: [{ path: "/pkg/game", portable: true, engineCount: 1 }],
    // The name unitsync reports, which is what a `gameFilter` matches. Not the
    // archive file name: they are different strings (issue #959).
    installedGames: ["Splinter Faction 1.3"],
    writeRootPath: "/pkg/game",
    campaignFailures: [],
    scenarioFailures: [],
    writable: { writeRoot: { writable: true }, dataDir: { writable: true } },
    hide: [],
    hideableNavIds: ["content.games", "downloads.browse", "downloads.games"],
    hideSettings: [],
    settingsIds: ["content-folders", "engines", "uberstress"],
    linkIcons: [],
    validIconNames: ["discord", "globe", "docs"],
  };
}

function maybeById(inputs: HealthInputs, id: string) {
  return deriveHealthChecks(inputs).find((x) => x.id === id);
}

function byId(inputs: HealthInputs, id: string) {
  const c = deriveHealthChecks(inputs).find((x) => x.id === id);
  if (!c) throw new Error(`no check ${id}`);
  return c;
}

describe("deriveHealthChecks", () => {
  it("reports portable mode active with the path in the label", () => {
    expect(byId(base(), "portable").status).toBe("ok");
    expect(byId(base(), "portable").label).toContain("/pkg/.coilbox");
  });

  it("flags a profile parse error", () => {
    const c = byId(
      { ...base(), profileError: "Unexpected token }" },
      "profile",
    );
    expect(c.status).toBe("error");
    expect(c.hint).toContain("Unexpected token");
  });

  it("surfaces the parse-error source excerpt as monospace detail", () => {
    const c = byId(
      {
        ...base(),
        profileError: "Line 13, column 3: ...",
        profileErrorSnippet: '13 |   "links": [\n     ^',
      },
      "profile",
    );
    expect(c.detail).toContain("links");
    expect(c.detail).toContain("^");
  });

  it("warns when the game filter matches zero installed games", () => {
    const c = byId({ ...base(), gameFilter: { regex: "^Nope" } }, "gameFilter");
    expect(c.status).toBe("warn");
    expect(c.label).toContain("0");
    // the hint names the filter and lists the installed games to match against.
    expect(c.hint).toContain("^Nope");
    expect(c.hint).toContain("Splinter Faction 1.3");
  });

  it("matches a filter against the name unitsync reports", () => {
    const c = byId(
      { ...base(), gameFilter: { names: ["Splinter Faction 1.3"] } },
      "gameFilter",
    );
    expect(c.status).toBe("ok");
    expect(c.label).toContain("1 installed game");
  });

  it("errors on an invalid game filter regex", () => {
    const c = byId({ ...base(), gameFilter: { regex: "(" } }, "gameFilter");
    expect(c.status).toBe("error");
    expect(c.hint).toContain("regex");
  });

  it("warns when portable but no root is portable", () => {
    const c = byId(
      { ...base(), roots: [{ path: "/x", portable: false, engineCount: 1 }] },
      "roots",
    );
    expect(c.status).toBe("warn");
  });

  it("warns when the write root is outside the package", () => {
    const c = byId(
      { ...base(), writeRootPath: "/home/user/.spring" },
      "writeRoot",
    );
    expect(c.status).toBe("warn");
  });

  it("does not treat a sibling folder sharing a name prefix as inside the package", () => {
    const c = byId(
      { ...base(), writeRootPath: "/pkg-backup/downloads" },
      "writeRoot",
    );
    expect(c.status).toBe("warn");
  });

  it("errors when a folder is read-only", () => {
    const c = byId(
      {
        ...base(),
        writable: {
          writeRoot: { writable: false, error: "denied" },
          dataDir: { writable: true },
        },
      },
      "writable",
    );
    expect(c.status).toBe("error");
    expect(c.hint).toContain("read-only");
  });

  it("warns when a campaign failed to load, naming it and the error", () => {
    const c = byId(
      {
        ...base(),
        campaignFailures: [
          {
            source: "bundled",
            name: "First Contact",
            error: "Line 3, column 5: bad",
          },
          {
            source: "local",
            name: "(unnamed)",
            error: "does not match the campaign schema",
          },
        ],
      },
      "campaigns",
    );
    expect(c.status).toBe("warn");
    expect(c.label).toContain("2");
    expect(c.detail).toContain("First Contact [bundled]");
    expect(c.detail).toContain("does not match the campaign schema");
  });

  it("warns when a scenario failed to load, naming it and the error", () => {
    const c = byId(
      {
        ...base(),
        scenarioFailures: [
          {
            source: "bundled",
            name: "Ambush",
            error: "That scenario was made by a newer version of coilbox.",
          },
        ],
      },
      "scenarios",
    );
    expect(c.status).toBe("warn");
    expect(c.label).toContain("1 scenario(s)");
    expect(c.hint).toContain(".coilbox/scenarios/");
    expect(c.detail).toContain("Ambush [bundled]");
    expect(c.detail).toContain("newer version of coilbox");
  });

  it("says scenarios loaded, and does so separately from campaigns", () => {
    const checks = deriveHealthChecks({
      ...base(),
      campaignFailures: [
        { source: "bundled", name: "First Contact", error: "bad" },
      ],
    });
    expect(checks.find((c) => c.id === "campaigns")?.status).toBe("warn");
    const scenarios = checks.find((c) => c.id === "scenarios");
    expect(scenarios?.status).toBe("ok");
    expect(scenarios?.label).toBe("All scenarios loaded");
  });

  it("warns when the package has no engine or no games", () => {
    const c = byId(
      {
        ...base(),
        roots: [{ path: "/pkg/game", portable: true, engineCount: 0 }],
      },
      "content",
    );
    expect(c.status).toBe("warn");
  });

  describe("before a scan has answered", () => {
    it("does not call an unscanned package one with no games", () => {
      const c = byId({ ...base(), installedGames: null }, "content");
      expect(c.status).toBe("unknown");
      expect(c.label).toContain("not scanned");
    });

    it("still names the engine problem first, because it is the reason", () => {
      const c = byId(
        {
          ...base(),
          installedGames: null,
          roots: [{ path: "/pkg/game", portable: true, engineCount: 0 }],
        },
        "content",
      );
      expect(c.status).toBe("warn");
      expect(c.label).toBe("No engine found");
    });

    it("does not tell an author their filter matches nothing", () => {
      const c = byId(
        {
          ...base(),
          installedGames: null,
          gameFilter: { names: ["Splinter Faction 1.3"] },
        },
        "gameFilter",
      );
      expect(c.status).toBe("unknown");
      expect(c.label).not.toContain("0");
    });
  });

  it("returns unknown for a check whose input is absent", () => {
    const c = byId({ ...base(), writeRootPath: undefined }, "writeRoot");
    expect(c.status).toBe("unknown");
  });

  describe("hide id no-op advisory", () => {
    it("warns and names a hide id that matches nothing", () => {
      const c = byId({ ...base(), hide: ["content.gmaes"] }, "hide");
      expect(c.status).toBe("warn");
      expect(c.hint).toContain("hide id 'content.gmaes' matches nothing");
      // lists the ids the profile could actually hide.
      expect(c.hint).toContain("content.games");
    });

    it("does not warn when every hide id is hideable", () => {
      const c = byId({ ...base(), hide: ["content.games"] }, "hide");
      expect(c.status).toBe("ok");
    });

    it("adds no hide row when the profile hides nothing", () => {
      expect(maybeById(base(), "hide")).toBeUndefined();
    });
  });

  describe("hideSettings id no-op advisory", () => {
    it("warns and names a hideSettings id that matches no section", () => {
      const c = byId(
        { ...base(), hideSettings: ["uberstres"] },
        "hideSettings",
      );
      expect(c.status).toBe("warn");
      expect(c.hint).toContain("hideSettings id 'uberstres' matches nothing");
    });

    it("does not warn for a real section id", () => {
      const c = byId(
        { ...base(), hideSettings: ["uberstress"] },
        "hideSettings",
      );
      expect(c.status).toBe("ok");
    });

    it("adds no hideSettings row when empty", () => {
      expect(maybeById(base(), "hideSettings")).toBeUndefined();
    });
  });

  describe("link icon no-op advisory", () => {
    it("warns and names an unknown link icon", () => {
      const c = byId({ ...base(), linkIcons: ["discrod"] }, "linkIcons");
      expect(c.status).toBe("warn");
      expect(c.hint).toContain("link icon 'discrod' is unknown");
    });

    it("does not warn for a curated icon (case-insensitively)", () => {
      const c = byId({ ...base(), linkIcons: ["Discord"] }, "linkIcons");
      expect(c.status).toBe("ok");
    });

    it("adds no link-icon row when no link sets an icon", () => {
      expect(maybeById(base(), "linkIcons")).toBeUndefined();
    });
  });
});
