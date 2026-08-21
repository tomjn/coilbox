/**
 * The unit builder's document.
 *
 * TypeScript owns this schema and Rust stores it as an opaque string, the same
 * seam campaigns use. Everything here is pure, so the rules can be tested
 * without a renderer or a filesystem.
 *
 * A piece is either geometry, when it has a `partId` or a `meshId`, or empty.
 * Empty pieces are not a coilbox invention: an s3o piece with no vertices is
 * how the format carries hierarchy, and how flares, aim points and build
 * emitters are expressed. They survive export. Anchors derived from a part's
 * bounding box do not, and exist only to snap against.
 *
 * The two ways to be geometry are not two halves of one unit. A unit is either
 * built out of the parts pack, where every piece names a part and the whole
 * unit samples one atlas, or imported whole from somebody else's `.s3o`, where
 * every piece names a mesh and the unit draws with its own texture. The two
 * cannot mix: an imported model's UVs point onto its own texture, so a lego
 * part dropped into it would sample the wrong image and nothing could fix that.
 * `project.imported` is what says which kind a unit is.
 */

export const LEGO_SCHEMA_VERSION = 1;

/** Extra snap targets beyond the ones derived from a part's bounding box. */
export interface LegoAnchor {
  id: string;
  name: string;
  position: [number, number, number];
}

/**
 * The shapes the engine will build a collision volume out of.
 *
 * These exact strings because of how the engine reads them: `CollisionVolume`
 * looks at the first character to pick the shape and the last to pick a
 * cylinder's axis, and anything it does not recognise falls through to a
 * sphere. `"cylx"` therefore has to keep both ends, and a typo like `"cube"`
 * would quietly become a sphere rather than fail.
 */
export type CollisionVolumeType =
  | "box"
  | "sphere"
  | "ellipsoid"
  | "cylx"
  | "cyly"
  | "cylz";

/** Every value `type` may take, for validating one that came off disk. */
const COLLISION_VOLUME_TYPES: CollisionVolumeType[] = [
  "box",
  "sphere",
  "ellipsoid",
  "cylx",
  "cyly",
  "cylz",
];

export interface LegoCollisionVolume {
  type: CollisionVolumeType;
  /**
   * The volume's full extent along x, y and z in elmos, not its radii: the
   * engine halves these itself.
   */
  scales: [number, number, number];
  /** From the middle of the model, which is the centre of its bounding box. */
  offsets: [number, number, number];
}

/**
 * A texture in the shared store, which is where an imported unit's textures
 * live.
 *
 * `key` is content addressed, `<sha256>.<ext>`, so two units naming the same
 * file hold one copy of it and a file edited outside coilbox gets a new key
 * rather than being served from a stale cache. `name` is what the file was
 * called where it came from, which is what the model header names and what an
 * export writes it back out as. `source` is where it was read from, which is
 * what refreshing it re-reads.
 */
export interface LegoTexture {
  key: string;
  name: string;
  source?: string;
}

/**
 * A unit imported whole from somebody else's `.s3o`, rather than built out of
 * the parts pack.
 *
 * The meshes are not here. They live in `lego/geometry/<projectId>.bin.gz`,
 * because the largest model measured is 15.0 MB as JSON against 3.1 MiB packed
 * and undo keeps sixty whole documents. See `rawGeometry.ts`.
 *
 * The textures are a pointer to what to draw with and nothing more. Changing
 * one swaps the texture and leaves the geometry and its UVs exactly as they
 * are: whether the new image suits them is the user's call to make and to undo.
 */
/**
 * The game a model was opened out of, recorded at the moment it was picked.
 *
 * Only a unit opened through the game picker has one. A unit opened through the
 * file dialog has {@link LegoImported.source} and nothing else, and reading a
 * game's name back out of a path is guesswork, so this is the field anything
 * grouping units by game reads first (#1819).
 */
export interface LegoImportedGame {
  /** The game's name as unitsync reports it, which is what a list shows. */
  name: string;
  /** The primary archive's file name, e.g. `SpringMCLegacy.sdd`. The identity
   *  behind the name, since two installs of one game share a name and a version
   *  bump changes it. */
  archive: string;
  /** Where the model sits inside that archive, e.g. `objects3d/arm/com.s3o`. */
  member: string;
  /** The unitdef that names this model, when one does. Absent for a feature, a
   *  wreck, or anything else no unitdef points at. */
  unit?: string;
}

export interface LegoImported {
  /**
   * The `.s3o` this came from, for saying where the unit came from.
   *
   * A file the user pointed at, or, for a model picked out of a game, the
   * archive's own path with the member appended. The second is not a file that
   * can be opened when the archive is packed, so it is a description of where
   * the model was rather than somewhere to read it again.
   */
  source: string;
  /** Present when the model was picked by game and unit rather than by path. */
  game?: LegoImportedGame;
  /** What the unit is painted with. Absent when it could not be found. */
  texture?: LegoTexture;
  /**
   * The second texture an `.s3o` names, whose red channel marks the regions the
   * engine paints in the player's colour. Not decoration: those regions are
   * black in the first texture, so a unit that loses this shows black patches.
   */
  teamMask?: LegoTexture;
  /** The texture name the header gave when the file could not be found. */
  missingTexture?: string;
  missingTeamMask?: string;
}

export interface LegoPiece {
  id: string;
  /** Lower case, unique, and safe as a Lua local, because scripts use it as one. */
  name: string;
  parentId: string | null;
  /** Null for an empty piece: a hierarchy node, flare, aim point or emitter. */
  partId: string | null;
  /**
   * Geometry taken verbatim from an imported model, by its key in the project's
   * geometry sidecar. Only ever set on a piece of an imported unit, where
   * `partId` is always null.
   */
  meshId?: string;
  /** Relative to the parent piece. */
  position: [number, number, number];
  /**
   * Where this piece's origin sits in its part, in the part's own space and
   * before rotation and scale. Absent means the part's middle, which is where
   * the pack recentres every part. This is the point the piece turns about.
   */
  pivot?: [number, number, number];
  /** Radians, XYZ euler. Baked into vertices on export, see the plan's D3. */
  rotation: [number, number, number];
  /**
   * A negative scale on one axis is a mirror, and the only record of one:
   * `mirror.ts` writes it and the exporter reverses winding on it. A separate
   * flag would be a second answer to the same question, free to disagree.
   */
  scale: [number, number, number];
  /** Drives which animation presets apply. Free-form until presets land. */
  role?: string;
  tags?: string[];
  /** Editor only, never affects export. */
  hidden?: boolean;
  customAnchors?: LegoAnchor[];
}

export interface LegoProject {
  schemaVersion: typeof LEGO_SCHEMA_VERSION;
  id: string;
  /** What the project is called in the overview. */
  name: string;
  /** Lower case. The base name of every exported file. */
  unitName: string;
  /** The parts library this unit was built against, and its version. */
  packId: string;
  packVersion: string;
  /**
   * The atlas this unit samples, by texture file name, which is what the s3o
   * names. Absent means the base pack's own atlas, so a unit built before atlas
   * packs existed needs no migration. Never the pack id: an atlas is bound to
   * the texture it ships, which is what a game folder ends up holding a copy
   * of, not to whoever shipped it.
   */
  atlas?: string;
  /**
   * Present when the unit was imported whole from somebody else's `.s3o`.
   *
   * Such a unit has no parts and no atlas, so the parts library and the atlas
   * picker are hidden for it and this is what they read to know that. Its
   * pieces name meshes in the geometry sidecar rather than parts in the pack.
   */
  imported?: LegoImported;
  createdAt: string;
  updatedAt: string;
  rootPieceId: string;
  pieces: LegoPiece[];
  /** s3o header values. Computed on export unless pinned here. */
  radius?: number;
  height?: number;
  mid?: [number, number, number];
  /**
   * What the engine collides, clicks and shoots at. Absent means one derived
   * from the model's bounding box, so a unit saved before this existed still
   * opens and still exports a volume that fits it.
   */
  collisionVolume?: LegoCollisionVolume;
  /**
   * Whether shots are tested against each piece instead of the whole unit.
   *
   * There is nothing to store per piece. The engine derives a box around every
   * piece's own vertices when it loads the model, and the only thing a unit
   * definition can say is whether to use them, so this is one flag for the
   * unit. See `collisionVolume.ts`.
   */
  pieceCollision?: boolean;
  /**
   * Whether a click picks the unit off each piece instead of the whole unit.
   *
   * The engine's own second switch, read in `ParseSelectionVolume` rather than
   * `ParseCollisionVolume`, over the same boxes. Separate from
   * `pieceCollision` because it is a separate choice: a unit can be shot at
   * piece by piece and still be clicked as one easy shape.
   */
  pieceSelection?: boolean;
  unitDef?: Record<string, string | number | boolean>;
  notes?: string;
  /** Canned animations applied to this unit, from `animPresets.ts`. */
  animations?: { presetId: string; params: Record<string, number> }[];
  /**
   * The unit's own Lua, once the user has taken it over.
   *
   * Absent means the presets still generate the script, which is where every
   * unit starts and where a unit saved before this existed stays. Present
   * means the presets are done with this unit: this text is what the builder
   * shows and what an export writes, exactly as it stands.
   */
  script?: string;
  /** Where this unit was last exported, so exporting again does not ask. */
  exportDir?: string;
  /** Whether that export also placed the shared atlas. Defaults to true. */
  exportTexture?: boolean;
  /** Whether it also wrote a unit script when the game had none. */
  exportScript?: boolean;
  /** Whether that export also wrote a .glb, for taking the unit into Blender. */
  exportGlb?: boolean;
  /** Whether that export also wrote an .obj and .mtl, for the same reason. */
  exportObj?: boolean;
}

/**
 * Normalise a name to something a unit script can use as a local.
 *
 * Lower case because the tooling is inconsistent about case and scripts address
 * pieces by name. Leading digits get a prefix because `1foot` is not an
 * identifier. Empty input becomes `piece` rather than nothing.
 */
export function normalisePieceName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (cleaned === "") return "piece";
  return /^[0-9]/.test(cleaned) ? `p${cleaned}` : cleaned;
}

/** Normalise, then add the smallest numeric suffix that is not already taken. */
export function uniquePieceName(raw: string, taken: Iterable<string>): string {
  const base = normalisePieceName(raw);
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function childrenOf(
  project: LegoProject,
  pieceId: string | null,
): LegoPiece[] {
  return project.pieces.filter((piece) => piece.parentId === pieceId);
}

export function pieceById(
  project: LegoProject,
  pieceId: string,
): LegoPiece | undefined {
  return project.pieces.find((piece) => piece.id === pieceId);
}

/** Depth-first from the root, the order pieces are written to an s3o. */
export function walkPieces(project: LegoProject): LegoPiece[] {
  const out: LegoPiece[] = [];
  const visit = (piece: LegoPiece) => {
    out.push(piece);
    for (const child of childrenOf(project, piece.id)) visit(child);
  };
  const root = pieceById(project, project.rootPieceId);
  if (root) visit(root);
  return out;
}

/**
 * Every piece in save order: depth-first from the root, so a parent always
 * comes before its children. Reparenting only changes a piece's `parentId`,
 * not its place in the array, so this is what has to keep that true.
 *
 * A cycle or a missing parent can leave pieces unreachable from the root.
 * Those follow in their existing order rather than being dropped, because
 * silently losing pieces on save would be worse than a document
 * `projectProblems` already flags as broken.
 */
export function orderedPieces(project: LegoProject): LegoPiece[] {
  const ordered = walkPieces(project);
  const reached = new Set(ordered.map((piece) => piece.id));
  const stray = project.pieces.filter((piece) => !reached.has(piece.id));
  return [...ordered, ...stray];
}

/** A piece and everything under it, for deleting or saving as a compound. */
export function descendantIds(project: LegoProject, pieceId: string): string[] {
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    for (const child of childrenOf(project, id)) visit(child.id);
  };
  visit(pieceId);
  return out;
}

/** A piece's kind, for the tree's type icon: whether it draws a part, or is
 *  a hierarchy node, flare, aim point or emitter with no vertices of its own. */
export type PieceKind = "geometry" | "empty";

export function pieceKind(piece: LegoPiece): PieceKind {
  return piece.partId || piece.meshId ? "geometry" : "empty";
}

/**
 * Whether a piece is hidden, either itself or because an ancestor is.
 *
 * The viewport hides a piece by making its group invisible, and three.js
 * already stops there without drawing anything under it. This mirrors that
 * for the tree, so a child row does not read as shown when nothing under a
 * hidden ancestor actually is. A cycle stops the walk rather than looping.
 */
export function isEffectivelyHidden(
  project: LegoProject,
  pieceId: string,
): boolean {
  const seen = new Set<string>();
  let current = pieceById(project, pieceId);
  while (current && !seen.has(current.id)) {
    if (current.hidden) return true;
    seen.add(current.id);
    current = current.parentId
      ? pieceById(project, current.parentId)
      : undefined;
  }
  return false;
}

/**
 * Everything wrong with a project, as sentences meant to be shown.
 *
 * Separate from parsing because the editor can hold a document mid-edit that is
 * momentarily invalid, and wants to say so rather than refuse to load it.
 */
export function projectProblems(project: LegoProject): string[] {
  const problems: string[] = [];
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));

  if (!byId.has(project.rootPieceId)) {
    problems.push("The root piece is missing.");
  }

  const names = new Map<string, number>();
  for (const piece of project.pieces) {
    names.set(piece.name, (names.get(piece.name) ?? 0) + 1);
    if (piece.name !== normalisePieceName(piece.name)) {
      problems.push(
        `"${piece.name}" is not usable as a name in a unit script.`,
      );
    }
    if (piece.parentId !== null && !byId.has(piece.parentId)) {
      problems.push(`"${piece.name}" hangs off a piece that no longer exists.`);
    }
  }
  for (const [name, count] of names) {
    if (count > 1) problems.push(`${count} pieces are called "${name}".`);
  }

  const roots = project.pieces.filter((piece) => piece.parentId === null);
  if (roots.length > 1) {
    problems.push(
      `${roots.length} pieces have no parent, but a model has one root.`,
    );
  }

  // Anything the walk from the root does not reach is either orphaned or in a
  // cycle. Both would make the exporter recurse forever.
  const reached = new Set(walkPieces(project).map((piece) => piece.id));
  const stranded = project.pieces.filter((piece) => !reached.has(piece.id));
  if (stranded.length > 0) {
    problems.push(
      `${stranded.length} pieces cannot be reached from the root, so they are in a loop or detached.`,
    );
  }

  return problems;
}

/** A new project holding a single empty root, which is what an s3o needs. */
export function newProject(options: {
  id: string;
  rootPieceId: string;
  name: string;
  unitName?: string;
  packId: string;
  packVersion: string;
  /** Left off for the base pack's atlas, which is what most units use. */
  atlas?: string;
  now: string;
}): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    unitName: normalisePieceName(options.unitName ?? options.name),
    packId: options.packId,
    packVersion: options.packVersion,
    ...(options.atlas ? { atlas: options.atlas } : {}),
    createdAt: options.now,
    updatedAt: options.now,
    rootPieceId: options.rootPieceId,
    pieces: [
      {
        id: options.rootPieceId,
        name: "base",
        parentId: null,
        partId: null,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    ],
  };
}

/**
 * Parse a stored document.
 *
 * Returns null only when the file is not a project at all. A project that is
 * merely wrong, a duplicate name or a missing part, still loads, because
 * refusing to open it would leave no way to fix it. `projectProblems` reports
 * those.
 */
export function parseLegoProjectJson(json: string): LegoProject | null {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  return parseLegoProjectData(data);
}

/**
 * The same parse as `parseLegoProjectJson`, from already-parsed data.
 *
 * Split out for callers that hold a project nested inside a larger JSON
 * document, such as a clipboard envelope, and would otherwise have to
 * `JSON.stringify` it back out just to parse it again.
 */
export function parseLegoProjectData(data: unknown): LegoProject | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;

  if (
    d.schemaVersion !== LEGO_SCHEMA_VERSION ||
    typeof d.id !== "string" ||
    typeof d.name !== "string" ||
    typeof d.rootPieceId !== "string" ||
    !Array.isArray(d.pieces)
  ) {
    return null;
  }

  // Imported names are made unique the same way rawImport.ts and compounds.ts
  // already make theirs: `uniquePieceName` normalises, so `luaScript.ts` can
  // still assume a name is identifier-safe, and dedupes against siblings, so
  // two pieces that normalise the same way do not collide into one Lua local.
  // A hole punched by rejecting the piece, or losing the whole import by
  // rejecting the document, would both be worse than silently renaming it,
  // and match parseLegoProjectJson's own contract just above: this project is
  // merely wrong, not unparsable.
  const pieces: LegoPiece[] = [];
  const takenNames = new Set<string>();
  for (const raw of d.pieces) {
    const piece = parsePiece(raw);
    if (!piece) return null;
    const name = uniquePieceName(piece.name, takenNames);
    takenNames.add(name);
    pieces.push(name === piece.name ? piece : { ...piece, name });
  }
  if (pieces.length === 0) return null;

  const mid = parseVec3(d.mid);
  const collisionVolume = parseCollisionVolume(d.collisionVolume);
  const project: LegoProject = {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: d.id,
    name: d.name,
    unitName:
      typeof d.unitName === "string" ? d.unitName : normalisePieceName(d.name),
    packId: typeof d.packId === "string" ? d.packId : "",
    packVersion: typeof d.packVersion === "string" ? d.packVersion : "",
    ...(typeof d.atlas === "string" && d.atlas !== ""
      ? { atlas: d.atlas }
      : {}),
    ...(() => {
      const imported = parseImported(d.imported);
      return imported ? { imported } : {};
    })(),
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    rootPieceId: d.rootPieceId,
    pieces,
    ...(typeof d.radius === "number" ? { radius: d.radius } : {}),
    ...(typeof d.height === "number" ? { height: d.height } : {}),
    ...(mid ? { mid } : {}),
    ...(collisionVolume ? { collisionVolume } : {}),
    ...(d.pieceCollision === true ? { pieceCollision: true } : {}),
    ...(d.pieceSelection === true ? { pieceSelection: true } : {}),
    ...(typeof d.unitDef === "object" && d.unitDef !== null
      ? { unitDef: d.unitDef as Record<string, string | number | boolean> }
      : {}),
    ...(typeof d.notes === "string" ? { notes: d.notes } : {}),
    ...(Array.isArray(d.animations)
      ? { animations: d.animations.map(parseApplied).filter((a) => a !== null) }
      : {}),
    ...(typeof d.script === "string" ? { script: d.script } : {}),
    ...(typeof d.exportDir === "string" ? { exportDir: d.exportDir } : {}),
    ...(typeof d.exportTexture === "boolean"
      ? { exportTexture: d.exportTexture }
      : {}),
    ...(typeof d.exportScript === "boolean"
      ? { exportScript: d.exportScript }
      : {}),
    ...(typeof d.exportGlb === "boolean" ? { exportGlb: d.exportGlb } : {}),
    ...(typeof d.exportObj === "boolean" ? { exportObj: d.exportObj } : {}),
  };
  // A document saved before pieces were written in save order, or hand-edited,
  // may not have its parents first. Normalise here so the invariant holds the
  // moment a project is in memory, not only after its next save.
  return { ...project, pieces: orderedPieces(project) };
}

function parsePiece(raw: unknown): LegoPiece | null {
  if (typeof raw !== "object" || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== "string" || p.id === "") return null;
  if (typeof p.name !== "string") return null;

  return {
    id: p.id,
    name: p.name,
    parentId: typeof p.parentId === "string" ? p.parentId : null,
    partId: typeof p.partId === "string" ? p.partId : null,
    ...(typeof p.meshId === "string" && p.meshId !== ""
      ? { meshId: p.meshId }
      : {}),
    position: parseVec3(p.position) ?? [0, 0, 0],
    rotation: parseVec3(p.rotation) ?? [0, 0, 0],
    scale: parseVec3(p.scale) ?? [1, 1, 1],
    ...(() => {
      const pivot = parseVec3(p.pivot);
      return pivot ? { pivot } : {};
    })(),
    ...(typeof p.role === "string" ? { role: p.role } : {}),
    ...(Array.isArray(p.tags)
      ? { tags: p.tags.filter((t): t is string => typeof t === "string") }
      : {}),
    ...(p.hidden === true ? { hidden: true } : {}),
    ...(Array.isArray(p.customAnchors)
      ? {
          customAnchors: p.customAnchors
            .map(parseAnchor)
            .filter((a): a is LegoAnchor => a !== null),
        }
      : {}),
  };
}

/**
 * Where an imported unit came from and what it draws with.
 *
 * A texture that will not parse is dropped rather than failing the project.
 * The unit then draws untextured and says which file it wanted, which is the
 * same call the import itself makes when a texture cannot be found: losing the
 * project over a missing image would be worse than drawing it plain.
 */
function parseImported(value: unknown): LegoImported | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string") return null;

  const texture = parseTexture(v.texture);
  const teamMask = parseTexture(v.teamMask);
  return {
    source: v.source,
    ...(texture ? { texture } : {}),
    ...(teamMask ? { teamMask } : {}),
    ...(typeof v.missingTexture === "string"
      ? { missingTexture: v.missingTexture }
      : {}),
    ...(typeof v.missingTeamMask === "string"
      ? { missingTeamMask: v.missingTeamMask }
      : {}),
  };
}

function parseTexture(value: unknown): LegoTexture | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || v.key === "") return null;
  if (typeof v.name !== "string") return null;
  return {
    key: v.key,
    name: v.name,
    ...(typeof v.source === "string" ? { source: v.source } : {}),
  };
}

/**
 * One applied animation preset. Unknown preset ids survive parsing, because a
 * document written by a newer build should not lose them on a round trip here.
 */
function parseApplied(
  raw: unknown,
): { presetId: string; params: Record<string, number> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.presetId !== "string" || a.presetId === "") return null;

  const params: Record<string, number> = {};
  if (typeof a.params === "object" && a.params !== null) {
    for (const [key, value] of Object.entries(a.params)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        params[key] = value;
      }
    }
  }
  return { presetId: a.presetId, params };
}

/**
 * A collision volume that was set by hand.
 *
 * All three fields have to be there. A half-written one would be half derived
 * and half set, with nothing to say which half, so it is dropped and the unit
 * goes back to a volume derived from its own geometry.
 */
function parseCollisionVolume(value: unknown): LegoCollisionVolume | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const type = COLLISION_VOLUME_TYPES.find((known) => known === v.type);
  const scales = parseVec3(v.scales);
  const offsets = parseVec3(v.offsets);
  if (!type || !scales || !offsets) return null;
  return { type, scales, offsets };
}

function parseAnchor(raw: unknown): LegoAnchor | null {
  if (typeof raw !== "object" || raw === null) return null;
  const a = raw as Record<string, unknown>;
  const position = parseVec3(a.position);
  if (typeof a.id !== "string" || typeof a.name !== "string" || !position)
    return null;
  return { id: a.id, name: a.name, position };
}

function parseVec3(value: unknown): [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n)))
    return null;
  return [value[0], value[1], value[2]];
}
