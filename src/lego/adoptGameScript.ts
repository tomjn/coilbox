/**
 * Take on a unit's own animation script when it is opened out of a game.
 *
 * A model imported from a game arrives as geometry. Its animation lives in a
 * separate file the game ships, and without it the unit opens with nothing
 * applied and re-exports as a unit that stands still. Coilbox knows which game
 * and which unit it came from, so it can go and read that file.
 *
 * Only Lua is adopted. A `.cob` is compiled bytecode, and an export writes Lua,
 * so adopting one would give a unit a script that cannot be written back. Those
 * are read through the disassembler and shown as a listing instead, which makes
 * a compiled unit legible without pretending it can be edited here.
 *
 * Nothing is ever written to a game. The `.cob` is read out of the archive as
 * bytes and disassembled in memory, so the file itself is never opened for
 * writing, copied, or touched in any way.
 *
 * Nothing here decides anything. It reads, it reports, and the caller shows the
 * result. Adoption replaces `project.script`, which is the same one way door as
 * taking a generated script over by hand, and the script drawer's "Discard this
 * script and use the presets" is the way back.
 */

import { animCobDisasmBytes } from "../animation/bindings";
import { unitsyncUnitScript } from "../content/bindings";
import { inferRoles, type RoleFindings } from "./inferRoles";
import type { LegoProject } from "./model";

export interface AdoptedScript {
  /** The Lua to store on the project, or null when there is none to adopt. */
  script: string | null;
  /** The archive member it came from, so the drawer can say where. */
  member: string | null;
  kind: "lua" | "cob" | null;
  /** What the unit definition asked for, whether or not it resolved. */
  declared: string | null;
  /** Roles the script names or shows, for the caller to offer. Null when there
   *  was no Lua to ask. */
  findings: RoleFindings | null;
  /**
   * A `.cob` read back as a disassembly listing, for reading only.
   *
   * Not BOS anybody could recompile and not something an export writes. It is
   * here so a unit whose animation is compiled is still legible rather than
   * being an opaque file coilbox merely names.
   */
  listing: string | null;
  /** What the reader wants to say: a unit with no script, a `.cob` that cannot
   *  be adopted, an archive that would not open. */
  notes: string[];
}

/** Nothing found and nothing to say, which is what a unit not out of a game is. */
const NOTHING: AdoptedScript = {
  script: null,
  member: null,
  kind: null,
  declared: null,
  findings: null,
  listing: null,
  notes: [],
};

/**
 * Read a `.cob` back as a listing, or say why it could not be.
 *
 * Straight from the bytes, so nothing is written anywhere and the file inside
 * the game archive is only ever read. A `.cob` that will not disassemble is a
 * note rather than a failure: the unit still imported and its model is fine.
 */
async function disassemble(
  bytes: number[] | null,
  notes: string[],
): Promise<string | null> {
  if (!bytes || bytes.length === 0) return null;
  try {
    const { listing } = await animCobDisasmBytes({ bytes });
    return listing;
  } catch (error) {
    notes.push(
      `That file could not be disassembled: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

/**
 * Read the script for a unit imported out of a game, and ask it what its pieces
 * are for.
 *
 * `engine` is the engine and content root the game is installed under, which is
 * what mounting its archive needs.
 *
 * Never throws. A game that will not mount, a unit with no script and a script
 * that will not run all come back as notes, because none of them is a reason to
 * fail an import that has already produced a working model.
 */
export async function adoptGameScript(
  project: LegoProject,
  engine: { enginePath: string; dataDir: string },
): Promise<AdoptedScript> {
  const game = project.imported?.game;
  // A unit with no unitdef behind it is a feature, a wreck, or a model nothing
  // points at. There is no definition to read a script name off.
  if (!game?.unit) return NOTHING;

  let result: Awaited<ReturnType<typeof unitsyncUnitScript>>;
  try {
    result = await unitsyncUnitScript({
      enginePath: engine.enginePath,
      dataDir: engine.dataDir,
      gameArchive: game.archive,
      unit: game.unit,
    });
  } catch (error) {
    return {
      ...NOTHING,
      notes: [
        `Could not read ${game.unit}'s script from ${game.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const notes = [...result.errors];

  if (!result.member || !result.kind) {
    // Worth naming what was asked for. A definition that names a script the
    // archive does not carry is a different problem from one naming none, and
    // only the first is worth going and looking at.
    notes.push(
      result.declared
        ? `${game.unit} names ${result.declared} as its script, and ${game.name} has no such file.`
        : `${game.unit} has no animation script in ${game.name}.`,
    );
    return { ...NOTHING, declared: result.declared, notes };
  }

  if (result.kind === "cob" || result.text === null) {
    notes.push(
      `${result.member} is compiled bytecode rather than Lua. Coilbox writes Lua, so this one is read and left where it is.`,
    );
    return {
      script: null,
      member: result.member,
      kind: "cob",
      declared: result.declared,
      findings: null,
      listing: await disassemble(result.bytes, notes),
      notes,
    };
  }

  const findings = await inferRoles(project, result.text);
  if (findings.error) notes.push(findings.error);

  return {
    script: result.text,
    member: result.member,
    kind: "lua",
    declared: result.declared,
    findings,
    listing: null,
    notes: [...new Set([...notes, ...findings.notes])],
  };
}

/**
 * Put accepted role proposals onto a project's pieces.
 *
 * A role already set by hand is never overwritten, because somebody deciding a
 * piece's job outranks a script being read about it. A proposal naming a piece
 * the unit does not have is dropped rather than added: it means the script and
 * the model disagree, which is worth nothing here and is already in the notes.
 */
export function applyRoles(
  project: LegoProject,
  roles: { pieceName: string; role: string }[],
): LegoProject {
  const wanted = new Map(roles.map((entry) => [entry.pieceName, entry.role]));
  return {
    ...project,
    pieces: project.pieces.map((piece) => {
      const role = wanted.get(piece.name);
      if (!role || piece.role) return piece;
      return { ...piece, role };
    }),
  };
}
