/**
 * Take on a unit's own animation script when it is opened out of a game.
 *
 * A model imported from a game arrives as geometry. Its animation lives in a
 * separate file the game ships, and without it the unit opens with nothing
 * applied and re-exports as a unit that stands still. Coilbox knows which game
 * and which unit it came from, so it can go and read that file.
 *
 * Only Lua is adopted. A `.cob` is compiled bytecode, and an export writes Lua,
 * so adopting one would give a unit a script that cannot be written back. It
 * still animates: the bytecode travels with the unit and the builder runs it,
 * which is exactly what the game plays. It is also disassembled and shown as a
 * listing, so a compiled unit is legible as well as watchable.
 *
 * Most games that compiled a script shipped the `.bos` source they compiled it
 * from, and that source is text coilbox already converts. So a compiled unit
 * still gets an animation, out of the source rather than the bytecode. The
 * converter is a textual transform whose output needs hand-fixing, so what
 * comes back is marked as a conversion and offered rather than taken on: a unit
 * animating subtly wrongly with nobody warned is worse than one standing still.
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
import { bos2lua } from "../animation/bos2lua";
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
  /**
   * Set when `script` is a conversion of the `.bos` source beside a `.cob`
   * rather than the game's own Lua.
   *
   * Its own field rather than a flag on `kind`, because the compiled file is
   * still what the game runs and `member` still names it. This says where the
   * Lua on offer actually came from.
   */
  converted: { member: string } | null;
  /**
   * The compiled bytecode itself, when the game ships one.
   *
   * Here so the unit can be played. Coilbox cannot write a `.cob`, but it can
   * run one, and running it is how a unit whose game compiled its animation
   * animates at all. The bytes travel with the project because the game they
   * came out of may not be installed the next time it is opened.
   */
  compiled: { member: string; bytes: number[] } | null;
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
  converted: null,
  compiled: null,
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
    const source = result.bosText?.trim() ? result.bosMember : null;
    notes.push(
      source
        ? `${result.member} is compiled bytecode rather than Lua. Coilbox runs it, so the unit animates either way. What is on offer here is ${source} converted, which is a script you can edit at the cost of accuracy: the converter is a set of text substitutions rather than a compiler, so read the result before trusting it.`
        : `${result.member} is compiled bytecode rather than Lua. Coilbox runs it, so the unit animates, but an export writes Lua and does not write this.`,
    );
    return {
      // Roles are deliberately not inferred from a conversion. Inferring them
      // means running the script and reading what moved, and calling that "the
      // script named these" would present a reading of a best-effort transform
      // as the game's own answer.
      script: source ? bos2lua(result.bosText ?? "") : null,
      member: result.member,
      kind: "cob",
      declared: result.declared,
      findings: null,
      listing: await disassemble(result.bytes, notes),
      converted: source ? { member: source } : null,
      compiled: result.bytes?.length
        ? { member: result.member, bytes: result.bytes }
        : null,
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
    converted: null,
    compiled: null,
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
