/**
 * Telling that a module in a unit has changed since it was inserted (#3304).
 *
 * A module's `updatedAt` moves on every save, a rename included, so it cannot
 * say the content changed. `moduleStamp` is a hash of the content instead, and
 * an insert writes it on each piece (`LegoModuleRef.rev`). An instance is out of
 * date when the stamp of the module now differs from the one it was inserted at.
 *
 * Nothing here changes a unit. The builder shows what `moduleUpdates` finds and
 * updates an instance only when the user asks, with `swapModule`.
 */

import type { LegoModuleRef, LegoPiece, LegoProject } from "./model";

/** Prefix of the ids the generated weapon and build arm record. */
const GENERATED_PREFIX = "generated:";

/** Whether a module id belongs to a generated piece, which has no module to update from. */
export function isGeneratedModule(id: string): boolean {
  return id.startsWith(GENERATED_PREFIX);
}

/** JSON with object keys sorted, so key order never changes the stamp. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: 53 bits of hash from a string, as 14 hex digits. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

/**
 * A stamp of what a module is made of: its root, pieces, presets, builder block
 * and mount. A rename, category, tags, picture and dates are left out, and so is
 * each piece's `module`, which is bookkeeping about where the piece came from.
 */
export function moduleStamp(module: LegoProject): string {
  return hash(
    canonical({
      root: module.rootPieceId,
      pieces: module.pieces.map(({ module: _from, ...piece }) => piece),
      animations: module.animations,
      builder: module.builder,
      mount: module.mount,
    }),
  );
}

/** One instance in a unit whose module has changed. */
export interface ModuleUpdate {
  instance: string;
  moduleId: string;
  /** The module's name now. */
  moduleName: string;
  /** The module's stamp now, which a dismissal is remembered against. */
  stamp: string;
  /** The instance's top piece, which names it to the user. */
  name: string;
  /** A piece of the instance to update it from. */
  rootPieceId: string;
  /**
   * Pieces of the instance renamed or moved since it was inserted. An update
   * overwrites them, so this is what the user is told before accepting.
   */
  edited: number;
}

/** One instance in a unit whose module is no longer in the list. */
export interface MissingModule {
  instance: string;
  moduleId: string;
  name: string;
  rootPieceId: string;
}

export interface ModuleUpdates {
  outdated: ModuleUpdate[];
  missing: MissingModule[];
}

/**
 * A fingerprint of a piece's name and, unless it is the top of its instance, its
 * place. A top piece sits where its join put it, so its place says nothing.
 */
export function pieceFingerprint(piece: LegoPiece, isTop: boolean): string {
  return hash(
    canonical([
      piece.name,
      isTop ? null : [piece.position, piece.rotation, piece.scale],
    ]),
  );
}

/**
 * The instances in `project` whose module has changed, and those whose module
 * is gone. A generated weapon or build arm has no module to update from, and an
 * instance inserted before stamps were recorded has nothing to compare, so
 * neither appears in either list.
 */
export function moduleUpdates(
  project: LegoProject,
  modules: readonly LegoProject[],
): ModuleUpdates {
  const byInstance = new Map<string, LegoPiece[]>();
  for (const piece of project.pieces) {
    if (!piece.module) continue;
    const group = byInstance.get(piece.module.instance);
    if (group) group.push(piece);
    else byInstance.set(piece.module.instance, [piece]);
  }

  const outdated: ModuleUpdate[] = [];
  const missing: MissingModule[] = [];
  for (const [instance, pieces] of byInstance) {
    const ref = pieces[0].module as LegoModuleRef;
    if (isGeneratedModule(ref.id)) continue;
    const ids = new Set(pieces.map((p) => p.id));
    const isTop = (p: LegoPiece) => !p.parentId || !ids.has(p.parentId);
    const top = pieces.find(isTop) ?? pieces[0];
    const module = modules.find((m) => m.id === ref.id);
    if (!module) {
      missing.push({
        instance,
        moduleId: ref.id,
        name: top.name,
        rootPieceId: top.id,
      });
      continue;
    }
    if (!ref.rev || ref.rev === moduleStamp(module)) continue;
    outdated.push({
      instance,
      moduleId: ref.id,
      moduleName: module.name,
      stamp: moduleStamp(module),
      name: top.name,
      rootPieceId: top.id,
      edited: pieces.filter(
        (p) => p.module?.fp && p.module.fp !== pieceFingerprint(p, isTop(p)),
      ).length,
    });
  }
  return { outdated, missing };
}
