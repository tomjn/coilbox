import { loadHandmadeMap } from "../conquest/handmade/library";
import {
  type HandmadeMapResult,
  hasBlankBattle,
} from "../conquest/handmade/read";
import { useHandmadeMap } from "../conquest/handmade/useHandmadeMaps";
import type { GalaxyDoc, NodeBattleSpec } from "../conquest/model";
import type { RunMapSource } from "./mapRun";
import type { RunMapRef } from "./model";

/**
 * Warpath on a hand-made map. The reader puts the author's markings on the
 * document as `warpath`, and this file turns that document into what the run
 * generator takes. A map with no markings is for Conquest only.
 */

/**
 * What a run across a hand-made map is generated from: the map, the author's
 * start and goal, the kinds they chose, and the battles they set. Null when
 * the author marked no start and goal.
 */
export function handmadeRunSource(doc: GalaxyDoc): RunMapSource | null {
  if (!doc.warpath) return null;
  const battles: Record<string, NodeBattleSpec> = {};
  for (const node of doc.nodes) {
    if (!hasBlankBattle(node)) battles[node.id] = node.battle;
  }
  return {
    map: doc,
    startId: doc.warpath.startId,
    goalId: doc.warpath.goalId,
    kinds: doc.warpath.kinds,
    battles,
  };
}

/** Why a hand-made map cannot be used, as a sentence for the player. Null when
 * it read without errors. */
function readProblem(id: string, result: HandmadeMapResult): string | null {
  if (result.ok) return null;
  const [first, ...rest] = result.errors;
  if (!first) return `The hand-made map "${id}" could not be read.`;
  // The library's own sentence for a map that is not installed.
  if (first.code === "file-missing" && rest.length === 0) return first.message;
  const more =
    rest.length === 0
      ? ""
      : rest.length === 1
        ? " There is 1 more problem with it."
        : ` There are ${rest.length} more problems with it.`;
  return `The hand-made map "${id}" could not be read. ${first.message}${more}`;
}

function listProblem(e: unknown): string {
  return `The hand-made maps could not be listed. ${e instanceof Error ? e.message : String(e)}`;
}

export type HandmadeRunMap =
  | { ok: true; source: RunMapSource }
  | { ok: false; message: string };

/**
 * Read an installed hand-made map for a new run. Fails with a sentence for the
 * player when the map is missing, cannot be read, or has no Warpath start and
 * goal.
 */
export async function loadHandmadeRunMap(id: string): Promise<HandmadeRunMap> {
  let result: HandmadeMapResult;
  try {
    result = await loadHandmadeMap(id);
  } catch (e) {
    return { ok: false, message: listProblem(e) };
  }
  if (!result.ok) {
    return { ok: false, message: readProblem(id, result) ?? "" };
  }
  const source = handmadeRunSource(result.doc);
  if (!source) {
    return {
      ok: false,
      message: `The hand-made map "${result.doc.title}" has no Warpath start and goal, so it can only be played in Conquest.`,
    };
  }
  return { ok: true, source };
}

/** The hand-made map a saved run is drawn on, as far as it has been read. */
export interface RunHandmadeMap {
  /** True until the read answers. Nothing can be drawn on the map before. */
  loading: boolean;
  /** The map, when it read. */
  map?: GalaxyDoc;
  /** Why the map cannot be drawn on, as a sentence for the player. */
  problem?: string;
}

const NO_HANDMADE_MAP: RunHandmadeMap = { loading: false };

/**
 * Read the hand-made map a run was made on. A run on a generated map, or on no
 * map, reads nothing and answers at once.
 */
export function useRunHandmadeMap(ref: RunMapRef | undefined): RunHandmadeMap {
  const id = ref?.source === "handmade" ? ref.id : undefined;
  const { loading, result, failure } = useHandmadeMap(id);
  if (id === undefined) return NO_HANDMADE_MAP;
  if (loading) return { loading: true };
  if (result?.ok) return { loading: false, map: result.doc };
  return {
    loading: false,
    problem: result
      ? (readProblem(id, result) ?? undefined)
      : listProblem(failure),
  };
}
