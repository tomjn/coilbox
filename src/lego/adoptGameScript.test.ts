/**
 * Reading a game unit's own script when its model is opened.
 *
 * The interesting cases are all the ways a unit has no script worth adopting: a
 * model nothing points at, a definition naming a file that is not there, and a
 * `.cob`, which coilbox can read but cannot write back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { adoptGameScript, applyRoles } from "./adoptGameScript";
import {
  type LegoImportedGame,
  type LegoPiece,
  type LegoProject,
  newProject,
} from "./model";

const readScript = vi.fn();
const infer = vi.fn();
const disasm = vi.fn();

vi.mock("../content/bindings", () => ({
  unitsyncUnitScript: (args: unknown) => readScript(args),
}));

vi.mock("../animation/bindings", () => ({
  animCobDisasmBytes: (args: unknown) => disasm(args),
}));

vi.mock("./inferRoles", () => ({
  inferRoles: (...args: unknown[]) => infer(...args),
}));

const ENGINE = { enginePath: "/engines/105", dataDir: "/data" };

const GAME: LegoImportedGame = {
  name: "Beyond All Reason",
  archive: "BAR.sdd",
  member: "objects3d/armcom.s3o",
  unit: "armcom",
};

function project(game: LegoImportedGame | null = GAME): LegoProject {
  const base = newProject({
    id: "p",
    rootPieceId: "root",
    name: "armcom",
    packId: "lego",
    packVersion: "1",
    now: "2026-08-22T00:00:00Z",
  });
  const pieces: LegoPiece[] = ["base", "turret"].map((name, i) => ({
    id: `p${i}`,
    name,
    parentId: "root",
    partId: null,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }));
  return {
    ...base,
    pieces,
    imported: {
      source: "armcom.s3o",
      ...(game ? { game } : {}),
    } as LegoProject["imported"],
  };
}

function found(over: Record<string, unknown> = {}) {
  return {
    member: "scripts/armcom.lua",
    kind: "lua",
    text: "-- the game's own\n",
    bytes: null,
    bosMember: null,
    bosText: null,
    declared: "armcom.cob",
    errors: [],
    ...over,
  };
}

beforeEach(() => {
  readScript.mockReset();
  infer.mockReset();
  readScript.mockResolvedValue(found());
  infer.mockResolvedValue({ proposals: [], notes: [], error: null });
  disasm.mockReset();
  disasm.mockResolvedValue({ listing: "; COB v4\n" });
});

describe("a unit opened out of a game", () => {
  it("adopts the Lua script the game ships for it", async () => {
    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.script).toBe("-- the game's own\n");
    expect(adopted.member).toBe("scripts/armcom.lua");
    expect(adopted.kind).toBe("lua");
  });

  it("asks the script it adopted what its pieces are for", async () => {
    infer.mockResolvedValue({
      proposals: [
        {
          pieceName: "turret",
          role: "turret",
          evidence: "observed",
          callin: "AimWeapon1",
        },
      ],
      notes: [],
      error: null,
    });

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(infer).toHaveBeenCalledWith(
      expect.anything(),
      "-- the game's own\n",
    );
    expect(adopted.findings?.proposals).toHaveLength(1);
  });

  it("asks the game for the unit's own key, not its model name", async () => {
    await adoptGameScript(project(), ENGINE);

    expect(readScript).toHaveBeenCalledWith(
      expect.objectContaining({ gameArchive: "BAR.sdd", unit: "armcom" }),
    );
  });
});

describe("when there is nothing to adopt", () => {
  /** A feature, a wreck, or a model no definition points at. There is no
   *  definition to read a script name off. */
  it("does nothing for a model no unit definition names", async () => {
    const adopted = await adoptGameScript(
      project({ ...GAME, unit: undefined }),
      ENGINE,
    );

    expect(adopted.script).toBeNull();
    expect(readScript).not.toHaveBeenCalled();
  });

  it("does nothing for a unit that did not come from a game at all", async () => {
    const adopted = await adoptGameScript(project(null), ENGINE);

    expect(adopted.script).toBeNull();
    expect(readScript).not.toHaveBeenCalled();
  });

  /**
   * Naming a file the archive does not carry is a different problem from
   * naming none, and only the first is worth going and looking at, so the two
   * say different things.
   */
  it("names the file a definition asked for when the game has no such file", async () => {
    readScript.mockResolvedValue(
      found({ member: null, kind: null, text: null, declared: "armcom.cob" }),
    );

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.script).toBeNull();
    expect(adopted.notes.join(" ")).toContain("armcom.cob");
    expect(adopted.notes.join(" ")).toContain("no such file");
  });

  it("says a unit simply has no script when its definition names none", async () => {
    readScript.mockResolvedValue(
      found({ member: null, kind: null, text: null, declared: null }),
    );

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.notes.join(" ")).toContain("no animation script");
  });
});

/**
 * Coilbox can read a `.cob` through its disassembler, but the result is BOS and
 * an export writes Lua. Adopting one would give a unit a script that cannot be
 * written back, so it is reported and left where it is.
 */
describe("a compiled script", () => {
  it("is named and reported rather than adopted", async () => {
    readScript.mockResolvedValue(
      found({ kind: "cob", text: null, member: "scripts/armcom.cob" }),
    );

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.script).toBeNull();
    expect(adopted.kind).toBe("cob");
    expect(adopted.member).toBe("scripts/armcom.cob");
    expect(adopted.notes.join(" ")).toContain("bytecode");
  });

  it("is not asked about roles, since nothing can run it here", async () => {
    readScript.mockResolvedValue(found({ kind: "cob", text: null }));

    await adoptGameScript(project(), ENGINE);

    expect(infer).not.toHaveBeenCalled();
  });

  /** Legible rather than an opaque file coilbox merely names. */
  it("is read back as a disassembly listing", async () => {
    readScript.mockResolvedValue(
      found({ kind: "cob", text: null, bytes: [1, 2, 3] }),
    );

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.listing).toBe("; COB v4\n");
  });

  /**
   * The whole point of a bytes-taking disassembly. Handing back a path would
   * mean writing a copy of a file inside somebody else's game, and the file
   * itself is never opened for writing either way.
   */
  it("is disassembled from its bytes, so nothing is written anywhere", async () => {
    readScript.mockResolvedValue(
      found({ kind: "cob", text: null, bytes: [1, 2, 3] }),
    );

    await adoptGameScript(project(), ENGINE);

    expect(disasm).toHaveBeenCalledWith({ bytes: [1, 2, 3] });
  });

  it("says so when the file will not disassemble, rather than failing", async () => {
    readScript.mockResolvedValue(
      found({ kind: "cob", text: null, bytes: [1, 2, 3] }),
    );
    disasm.mockRejectedValue(new Error("not a cob file"));

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.listing).toBeNull();
    expect(adopted.notes.join(" ")).toContain("not a cob file");
  });

  it("asks for no disassembly when the read handed back no bytes", async () => {
    readScript.mockResolvedValue(found({ kind: "cob", text: null, bytes: [] }));

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.listing).toBeNull();
    expect(disasm).not.toHaveBeenCalled();
  });
});

/**
 * Most games that compiled a script shipped the source they compiled it from,
 * and coilbox can already turn that source into Lua. The converter is textual
 * and its output needs hand-fixing, so what matters here is that the result is
 * marked as a conversion rather than passed off as the game's own file.
 */
describe("a compiled script whose game ships its source", () => {
  const withSource = () =>
    found({
      kind: "cob",
      text: null,
      member: "scripts/armcom.cob",
      bytes: [1, 2, 3],
      bosMember: "scripts/armcom.bos",
      bosText: "piece base, turret;\n",
    });

  it("offers the source converted to Lua", async () => {
    readScript.mockResolvedValue(withSource());

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.script).toContain("local base = piece 'base'");
    expect(adopted.script).toContain("local turret = piece 'turret'");
  });

  it("names the file the conversion came from", async () => {
    readScript.mockResolvedValue(withSource());

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.converted?.member).toBe("scripts/armcom.bos");
  });

  /** The compiled file is still what the game runs, and the disassembly is
   *  still the only faithful reading of it. */
  it("still reports the compiled file it sits beside", async () => {
    readScript.mockResolvedValue(withSource());

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.kind).toBe("cob");
    expect(adopted.member).toBe("scripts/armcom.cob");
    expect(adopted.listing).toBe("; COB v4\n");
  });

  /**
   * A converted script is a best-effort textual transform. Watching it move
   * pieces and calling that "the script named these" would dress a guess about
   * a guess as the game's own answer.
   */
  it("is not asked about roles", async () => {
    readScript.mockResolvedValue(withSource());

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(infer).not.toHaveBeenCalled();
    expect(adopted.findings).toBeNull();
  });

  it("says the conversion needs checking rather than leaving it implied", async () => {
    readScript.mockResolvedValue(withSource());

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.notes.join(" ")).toContain("scripts/armcom.bos");
    expect(adopted.notes.join(" ")).toContain("converted");
  });

  it("offers nothing to convert when the game shipped only the compiled file", async () => {
    readScript.mockResolvedValue(
      found({ kind: "cob", text: null, bytes: [1, 2, 3] }),
    );

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.converted).toBeNull();
    expect(adopted.script).toBeNull();
  });

  /** A game that ships Lua has nothing to convert, and a conversion beside it
   *  would be an older source of a script already superseded. */
  it("offers nothing to convert for a game that ships Lua", async () => {
    readScript.mockResolvedValue(found({ bosText: "piece base;\n" }));

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.converted).toBeNull();
    expect(adopted.script).toBe("-- the game's own\n");
  });
});

describe("when the read itself fails", () => {
  it("comes back as a note rather than throwing", async () => {
    readScript.mockRejectedValue(new Error("the worker is missing"));

    const adopted = await adoptGameScript(project(), ENGINE);

    expect(adopted.script).toBeNull();
    expect(adopted.notes.join(" ")).toContain("the worker is missing");
  });
});

describe("putting accepted roles on the pieces", () => {
  it("sets the role on the piece the proposal names", () => {
    const next = applyRoles(project(), [
      { pieceName: "turret", role: "turret" },
    ]);

    expect(next.pieces.find((p) => p.name === "turret")?.role).toBe("turret");
  });

  /** Somebody deciding a piece's job outranks a script being read about it. */
  it("never overwrites a role already set by hand", () => {
    const doc = project();
    const withRole = {
      ...doc,
      pieces: doc.pieces.map((p) =>
        p.name === "turret" ? { ...p, role: "barrel" } : p,
      ),
    };

    const next = applyRoles(withRole, [
      { pieceName: "turret", role: "turret" },
    ]);

    expect(next.pieces.find((p) => p.name === "turret")?.role).toBe("barrel");
  });

  /** The script and the model disagreeing is already in the notes, and adding
   *  a piece here would invent one the model does not have. */
  it("drops a proposal for a piece the unit does not have", () => {
    const next = applyRoles(project(), [
      { pieceName: "nano9", role: "buildarm.nano" },
    ]);

    expect(next.pieces).toHaveLength(project().pieces.length);
    expect(next.pieces.some((p) => p.name === "nano9")).toBe(false);
  });
});
