import { describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import type { LegoPiece, LegoProject } from "./model";
import { SCRATCH_SHORTNAME } from "./scratchGame";
import { skeletonFilePath } from "./skeletonFile";
import {
  clearTestUnit,
  nameTestUnit,
  prepareTestSkeleton,
  TEST_UNIT_KEY,
  type TestSkeletonDeps,
} from "./testSkeleton";

vi.mock("@/content/config", () => ({ primeGameInfo: vi.fn() }));
vi.mock("@/content/bindings", () => ({
  contentWidgetStatus: vi.fn(),
  contentWidgetInstall: vi.fn(),
}));

function piece(name: string, over: Partial<LegoPiece> = {}): LegoPiece {
  return { id: name, name, ...over } as LegoPiece;
}

function unit(unitName: string, skeleton = true): LegoProject {
  return {
    id: unitName,
    unitName,
    skeleton: skeleton ? { plan: "biped", proportions: {} } : undefined,
    pieces: [
      piece("body", { bone: "body", role: "base" }),
      piece("lthigh", { bone: "thigh.l1", role: "leg.l1.thigh" }),
    ],
  } as unknown as LegoProject;
}

const entry = {
  evidence: "built" as const,
  pieces: { body: { bone: "body", label: "Base" } },
};

describe("nameTestUnit", () => {
  it("names the unit in a file that was not there", () => {
    const file = JSON.parse(nameTestUnit(null, "fedwalker", true));
    expect(file[TEST_UNIT_KEY]).toBe("fedwalker");
    expect(file.version).toBe(1);
  });

  it("keeps the units and the keys it does not know", () => {
    const before = JSON.stringify({
      version: 1,
      other: { keep: true },
      units: { fedtank: entry, fedwalker: entry },
    });
    const file = JSON.parse(nameTestUnit(before, "fedwalker", true));
    expect(file.other).toEqual({ keep: true });
    expect(Object.keys(file.units).sort()).toEqual(["fedtank", "fedwalker"]);
  });

  it("replaces the unit the last test named", () => {
    const before = nameTestUnit(null, "fedtank", true);
    const file = JSON.parse(nameTestUnit(before, "fedwalker", true));
    expect(file[TEST_UNIT_KEY]).toBe("fedwalker");
  });

  it("names a unit with no skeleton and drops a plan it had before", () => {
    const before = JSON.stringify({
      version: 1,
      units: { fedwalker: entry, fedtank: entry },
    });
    const file = JSON.parse(nameTestUnit(before, "fedwalker", false));
    expect(file[TEST_UNIT_KEY]).toBe("fedwalker");
    expect(file.units.fedwalker).toBeUndefined();
    expect(file.units.fedtank).toEqual(entry);
  });

  it("drops a plan kept under another case of the name", () => {
    const before = JSON.stringify({
      version: 1,
      units: { FedWalker: entry, fedtank: entry },
    });
    const file = JSON.parse(nameTestUnit(before, "fedwalker", false));
    expect(Object.keys(file.units)).toEqual(["fedtank"]);
  });

  it("refuses a file that is not a skeleton file, so it is not written over", () => {
    expect(() => nameTestUnit("{ nope", "fedwalker", true)).toThrow(/not JSON/);
  });
});

const SCHEMA: ConfigOption[] = [
  { key: "allowuserwidgets", name: "Allow", type: "bool", default: "0" },
] as ConfigOption[];

function deps(over: Partial<TestSkeletonDeps> = {}) {
  const files = new Map<string, string>();
  const made = {
    files,
    widgetStatus: vi.fn(async () => ({
      installed: true,
      current: true,
      files: [],
      stale: [],
    })),
    widgetInstall: vi.fn(async () => ({ written: [] })),
    gameOptions: vi.fn(async () => SCHEMA),
    io: {
      read: vi.fn(async (path: string) => files.get(path) ?? null),
      write: vi.fn(async (path: string, text: string) => {
        files.set(path, text);
      }),
    },
    ...over,
  };
  return made;
}

const target = { enginePath: "/engine", dataDir: "/data" };
const path = skeletonFilePath("/data", SCRATCH_SHORTNAME);

function prepare(d: ReturnType<typeof deps>, project = unit("fedwalker")) {
  return prepareTestSkeleton(
    { target, baseArchive: "sf.sdz", project, modOptions: {} },
    d,
  );
}

describe("prepareTestSkeleton", () => {
  it("writes the file under the scratch game's short name", async () => {
    const d = deps();
    const result = await prepare(d);
    expect(path).toContain(`${SCRATCH_SHORTNAME}.json`);
    const file = JSON.parse(d.files.get(path) ?? "{}");
    expect(file[TEST_UNIT_KEY]).toBe("fedwalker");
    expect(file.units.fedwalker.pieces.lthigh.bone).toBe("thigh.l1");
    expect(result.problem).toBeNull();
  });

  it("leaves a current widget alone", async () => {
    const d = deps();
    await prepare(d);
    expect(d.widgetInstall).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { installed: false, current: false }],
    ["out of date", { installed: true, current: false }],
  ])("installs a widget that is %s", async (_name, status) => {
    const d = deps({
      widgetStatus: vi.fn(async () => ({ files: [], stale: [], ...status })),
    });
    await prepare(d);
    expect(d.widgetInstall).toHaveBeenCalledWith({
      rootPath: "/data",
      widget: "skeleton",
    });
  });

  it("turns allowuserwidgets on for a game that ships it off", async () => {
    const result = await prepare(deps());
    expect(result.modOptions).toEqual({ allowuserwidgets: "1" });
  });

  it("keeps the value the player set", async () => {
    const result = await prepareTestSkeleton(
      {
        target,
        baseArchive: "sf.sdz",
        project: unit("fedwalker"),
        modOptions: { allowuserwidgets: "0" },
      },
      deps(),
    );
    expect(result.modOptions).toEqual({ allowuserwidgets: "0" });
  });

  it("leaves the options alone for a game that does not define it", async () => {
    const result = await prepare(deps({ gameOptions: vi.fn(async () => []) }));
    expect(result.modOptions).toEqual({});
  });

  it("names a unit with no skeleton all the same", async () => {
    const d = deps();
    await prepare(d, unit("fedturret", false));
    const file = JSON.parse(d.files.get(path) ?? "{}");
    expect(file[TEST_UNIT_KEY]).toBe("fedturret");
    expect(file.units.fedturret).toBeUndefined();
  });

  it("says why when the widget cannot be installed, and still writes the file", async () => {
    const d = deps({
      widgetInstall: vi.fn(async () => {
        throw new Error("read only folder");
      }),
      widgetStatus: vi.fn(async () => ({
        installed: false,
        current: false,
        files: [],
        stale: [],
      })),
    });
    const result = await prepare(d);
    expect(result.problem).toContain("read only folder");
    expect(result.modOptions).toEqual({});
    expect(d.files.has(path)).toBe(true);
  });

  it("says why when the file cannot be written, and does not throw", async () => {
    const d = deps({
      io: {
        read: vi.fn(async () => null),
        write: vi.fn(async () => {
          throw new Error("disk full");
        }),
      },
    });
    const result = await prepare(d);
    expect(result.problem).toContain("disk full");
    expect(result.modOptions).toEqual({});
  });

  it("does not write over a file it cannot read", async () => {
    const d = deps();
    d.files.set(path, "{ nope");
    const result = await prepare(d);
    expect(result.problem).toContain("not JSON");
    expect(d.io.write).not.toHaveBeenCalled();
  });

  it("launches without the option and says why when the game's options cannot be read", async () => {
    const d = deps({
      gameOptions: vi.fn(async () => {
        throw new Error("no unitsync");
      }),
    });
    const result = await prepare(d);
    expect(result.modOptions).toEqual({});
    expect(result.problem).toContain("no unitsync");
  });
});

describe("clearTestUnit", () => {
  const io = (text: string | null) => {
    const files = new Map<string, string>();
    if (text !== null) files.set(path, text);
    return {
      files,
      io: {
        read: vi.fn(async (p: string) => files.get(p) ?? null),
        write: vi.fn(async (p: string, t: string) => {
          files.set(p, t);
        }),
      },
    };
  };

  it("removes the key and keeps the plans", async () => {
    const held = io(nameTestUnit(null, "fedwalker", true));
    await clearTestUnit("/data", held.io);
    const file = JSON.parse(held.files.get(path) ?? "{}");
    expect(file[TEST_UNIT_KEY]).toBeUndefined();
    expect(file.version).toBe(1);
  });

  it("writes nothing when there is no key or no file", async () => {
    const none = io(null);
    await clearTestUnit("/data", none.io);
    const bare = io(JSON.stringify({ version: 1, units: {} }));
    await clearTestUnit("/data", bare.io);
    expect(none.io.write).not.toHaveBeenCalled();
    expect(bare.io.write).not.toHaveBeenCalled();
  });

  it("does not throw for a file it cannot read", async () => {
    const broken = io("{ nope");
    await expect(clearTestUnit("/data", broken.io)).resolves.toBeUndefined();
    expect(broken.io.write).not.toHaveBeenCalled();
  });
});
