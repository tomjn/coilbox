import { describe, expect, it } from "vitest";
import { deriveHealthChecks, type HealthInputs } from "./health";

function base(): HealthInputs {
  return {
    portableRoot: "/pkg/.coilbox",
    profileSource: "file",
    profileError: null,
    gameFilter: undefined,
    roots: [{ path: "/pkg/game", portable: true, engineCount: 1 }],
    installedGames: ["splinter_1.3.sdz"],
    writeRootPath: "/pkg/game",
    campaignFailures: { bundled: 0, local: 0 },
    writable: { writeRoot: { writable: true }, dataDir: { writable: true } },
  };
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

  it("warns when the game filter matches zero installed games", () => {
    const c = byId({ ...base(), gameFilter: { regex: "^Nope" } }, "gameFilter");
    expect(c.status).toBe("warn");
    expect(c.label).toContain("0");
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

  it("warns when a bundled campaign failed to load", () => {
    const c = byId(
      { ...base(), campaignFailures: { bundled: 2, local: 0 } },
      "campaigns",
    );
    expect(c.status).toBe("warn");
    expect(c.label).toContain("2");
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

  it("returns unknown for a check whose input is absent", () => {
    const c = byId({ ...base(), writeRootPath: undefined }, "writeRoot");
    expect(c.status).toBe("unknown");
  });
});
