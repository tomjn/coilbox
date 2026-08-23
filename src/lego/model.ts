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
 * What one piece is hit with, when the box the engine measures for it is the
 * wrong answer.
 *
 * The engine builds a box round every piece's own vertices as the model loads
 * and nothing declares that, so this is not a volume the export can write down.
 * It is applied on the live unit by `Spring.SetUnitPieceCollisionVolumeData`,
 * out of the file `pieceCollisionScript.ts` generates. See that file for why it
 * is a file of its own rather than something in the unit script.
 */
export interface LegoPieceCollision {
  /** False tells the engine to hit nothing on this piece at all. */
  hit: boolean;
  /**
   * Absent means the box the engine measures off the piece's own vertices,
   * which is what a piece switched off but not resized carries.
   *
   * Its offsets are in the piece's own space, unlike the unit volume's, which
   * are measured from the aim point.
   */
  volume?: LegoCollisionVolume;
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
 *
 * `source` is absent whenever there is no file to go back to. A model unpacked
 * out of a packed archive is read out of a temp folder the operating system
 * reclaims, so a path recorded against one points at nothing an hour later
 * (#1903). Refresh is off in that case and says to choose a file, which is the
 * honest answer: coilbox already has its own copy, and the archive never held a
 * path to hand back.
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
/**
 * Whether a game archive is a loose folder, so what it names are real files.
 *
 * A `.sdd` is a directory: its models and textures are on disk under their own
 * paths, and an import reads them where they lie. Every other kind holds its
 * members with no path to them, so an import has to unpack what it wants into a
 * temp folder first, and nothing it read is still there afterwards.
 */
export function isLooseArchive(archive: string): boolean {
  return archive.toLowerCase().endsWith(".sdd");
}

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

/**
 * What a unit that builds is worth, as three unit definition keys.
 *
 * All three go in together, and that is not tidiness. `UnitDef::IsBuilderUnit`
 * is `builder && buildSpeed > 0 && buildDistance > 0`, and `builder` is then
 * `&=`'d against it, so `builder = true` with the engine's own `workerTime`
 * default of zero clears itself and the unit is silently not a builder.
 */
export interface LegoBuilder {
  /** Written as `workerTime`. Build, repair, reclaim and capture speed all
   *  default to this one number. */
  workerTime?: number;
  /** How far it reaches, in elmos. The engine clamps this up to 38. */
  buildDistance?: number;
  /** Whether it can help another unit's build. The engine defaults this to
   *  whatever `builder` is, so absent means true for a builder. */
  canAssist?: boolean;
}

/** What a unit with no `builder` block of its own is worth. `workerTime` has to
 *  be above zero or the engine discards the whole thing: see `LegoBuilder`. */
export const DEFAULT_BUILDER: Required<LegoBuilder> = {
  workerTime: 100,
  buildDistance: 128,
  canAssist: true,
};

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
   * The second texture an `.s3o` names: glow in red, reflectivity in green, and
   * in alpha the one-bit mask that says whether a pixel is drawn at all. Not
   * decoration. A unit that loses it draws the faces the game cuts away, which
   * is a solid rectangle where a radar dish or a fence should be.
   *
   * Named after the `.s3o` header's own field rather than after what the
   * channels mean, because the last name that made a claim about the meaning was
   * wrong for a year: it was `teamMask`, and the team-colour mask is the first
   * texture's alpha (#1910). A document written before the rename is read below.
   */
  texture2?: LegoTexture;
  /** The texture name the header gave when the file could not be found. */
  missingTexture?: string;
  missingTexture2?: string;
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
  /**
   * What this piece is hit with, when the box the engine measures round its own
   * vertices is not what should stop a shot. Absent means that box, which is
   * where every piece starts.
   */
  collision?: LegoPieceCollision;
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
  /**
   * How fast and how far this unit builds, when it builds at all.
   *
   * Absent means the defaults, which is where a unit with a build arm starts:
   * the panel opens on them and touching a field takes them over, the same rule
   * the collision volume and the aim point follow.
   *
   * Whether the keys are written at all is not stored here. It follows from the
   * unit having a piece in a `buildarm.*` role, because a unit with a build arm
   * modelled and nothing driving it is not a thing anybody wants.
   */
  builder?: LegoBuilder;
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
  /**
   * The compiled animation script the unit's game ships, when it ships one.
   *
   * A `.cob` is bytecode rather than Lua, so it can be played but not edited
   * and not written back by an export. It is kept here, bytes and all, because
   * it is the only copy coilbox has: the game it came out of may not be
   * installed the next time this project is opened.
   *
   * A unit that also has `script` is past this. Taking a script over is a
   * decision, and the text somebody owns beats the file they came in with.
   */
  compiledScript?: { member: string; bytes: number[] };
  /**
   * The definition the unit's game gives it, for a script that reads one.
   *
   * A unit script may read its own definition, and Beyond All Reason's do:
   * `coralab.lua` picks which of two animations it has out of
   * `customParams.litelab`. Without it the script throws at load and the unit
   * does not animate at all.
   *
   * Stored rather than re-read, for the same reason the compiled script is: the
   * game it came out of may not be installed the next time this is opened.
   * Absent for a unit built out of parts, which has no definition to have.
   */
  gameUnitDef?: Record<string, unknown>;
  /**
   * The library files the unit's script pulls in with `include`, keyed by the
   * name it asks for.
   *
   * A game may keep half its animation in a shared library and have every unit
   * pull it in, which is Beyond All Reason's house style. Without the file the
   * script stops on the first line that calls into it.
   *
   * Stored rather than re-read, for the same reason the definition is. Absent
   * for a unit built out of parts, whose script pulls in nothing but coilbox's
   * own collision file.
   */
  gameScriptIncludes?: Record<string, string>;
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
  const builder = parseBuilder(d.builder);
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
    ...(builder ? { builder } : {}),
    ...(typeof d.unitDef === "object" && d.unitDef !== null
      ? { unitDef: d.unitDef as Record<string, string | number | boolean> }
      : {}),
    ...(typeof d.notes === "string" ? { notes: d.notes } : {}),
    ...(Array.isArray(d.animations)
      ? { animations: d.animations.map(parseApplied).filter((a) => a !== null) }
      : {}),
    ...(typeof d.script === "string" ? { script: d.script } : {}),
    ...(parseCompiledScript(d.compiledScript) ?? {}),
    ...(typeof d.gameUnitDef === "object" && d.gameUnitDef !== null
      ? { gameUnitDef: d.gameUnitDef as Record<string, unknown> }
      : {}),
    ...(parseScriptIncludes(d.gameScriptIncludes) ?? {}),
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
    ...(() => {
      const collision = parsePieceCollision(p.collision);
      return collision ? { collision } : {};
    })(),
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
 *
 * The second texture is read under `teamMask` as well as under `texture2`,
 * because that is what every document written before #1910 calls it. The old
 * name is only ever read: a save writes the new one, so a unit migrates the next
 * time it is touched and one nobody touches goes on working untouched. Same deal
 * `parseGameIdentity` makes with the spellings that predate #1335.
 */
function parseImported(value: unknown): LegoImported | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.source !== "string") return null;

  const game = parseImportedGame(v.game);
  // A model out of a packed archive was read from a temp folder that is long
  // gone, so a source recorded against one is a path to nothing (#1903). The
  // import stopped writing them, and this is for the documents that already
  // have one: without it those units go on offering a Refresh that can only
  // fail.
  const packed = game !== null && !isLooseArchive(game.archive);
  const texture = parseTexture(v.texture, packed);
  const texture2 = parseTexture(v.texture2 ?? v.teamMask, packed);
  const missingTexture2 = v.missingTexture2 ?? v.missingTeamMask;
  return {
    source: v.source,
    ...(game ? { game } : {}),
    ...(texture ? { texture } : {}),
    ...(texture2 ? { texture2 } : {}),
    ...(typeof v.missingTexture === "string"
      ? { missingTexture: v.missingTexture }
      : {}),
    ...(typeof missingTexture2 === "string" ? { missingTexture2 } : {}),
  };
}

/**
 * The game a unit was opened out of.
 *
 * The name, the archive and the member are all required, because the three are
 * written together and two of them are no use on their own: a name with no
 * archive cannot be matched against a game and an archive with no member cannot
 * be matched against a model. Half a record is dropped rather than kept, which
 * puts the unit back on the path fallback, exactly where one opened before this
 * field existed already sits.
 */
function parseImportedGame(value: unknown): LegoImportedGame | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.name !== "string" ||
    typeof v.archive !== "string" ||
    typeof v.member !== "string"
  ) {
    return null;
  }
  return {
    name: v.name,
    archive: v.archive,
    member: v.member,
    // Absent for a feature or a wreck, which no unitdef names.
    ...(typeof v.unit === "string" ? { unit: v.unit } : {}),
  };
}

/** One stored texture. `packed` drops the source, for the reason above. */
function parseTexture(value: unknown, packed: boolean): LegoTexture | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || v.key === "") return null;
  if (typeof v.name !== "string") return null;
  return {
    key: v.key,
    name: v.name,
    ...(!packed && typeof v.source === "string" ? { source: v.source } : {}),
  };
}

/**
 * The script's library files off a saved project.
 *
 * Only the entries that are text, because anything else is not a file a script
 * could have been given. A file dropped here is one `include` reads nothing
 * for, which the preview says when the script asks.
 */
function parseScriptIncludes(
  raw: unknown,
): { gameScriptIncludes: Record<string, string> } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const files = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (files.length === 0) return null;
  return { gameScriptIncludes: Object.fromEntries(files) };
}

/**
 * A compiled script off a saved project, or nothing when there is not one.
 *
 * An empty byte array is nothing rather than an empty script: it would play as
 * a unit that stands still, which is exactly what having no script looks like,
 * and keeping it would mean the panel claiming an animation that is not there.
 */
function parseCompiledScript(
  raw: unknown,
): { compiledScript: LegoProject["compiledScript"] } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.member !== "string" || !Array.isArray(value.bytes)) {
    return null;
  }
  const bytes = value.bytes.filter((byte): byte is number =>
    Number.isInteger(byte),
  );
  if (bytes.length === 0) return null;
  return { compiledScript: { member: value.member, bytes } };
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

/**
 * A unit's build tuning, keeping only the fields it actually carries.
 *
 * An empty block is dropped rather than stored, so a unit that was opened,
 * looked at and left alone does not gain a key saying nothing. The defaults
 * fill in whatever is absent at write time: see `DEFAULT_BUILDER`.
 */
function parseBuilder(value: unknown): LegoBuilder | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const builder: LegoBuilder = {
    // Zero is a real number here and a broken one: the engine reads a builder
    // with no work rate as not a builder. It is kept rather than swapped for a
    // default, because silently rewriting a number somebody typed is worse
    // than showing them the number that does nothing.
    ...(typeof v.workerTime === "number" && Number.isFinite(v.workerTime)
      ? { workerTime: v.workerTime }
      : {}),
    ...(typeof v.buildDistance === "number" && Number.isFinite(v.buildDistance)
      ? { buildDistance: v.buildDistance }
      : {}),
    ...(typeof v.canAssist === "boolean" ? { canAssist: v.canAssist } : {}),
  };
  return Object.keys(builder).length > 0 ? builder : null;
}

/**
 * One piece's collision override.
 *
 * A record saying only `hit: true` with no volume is what a piece switched off
 * and back on again leaves behind, and is the same as no record at all, so it
 * is dropped rather than stored. That keeps "does this unit override anything"
 * an honest question to ask of the document.
 */
function parsePieceCollision(value: unknown): LegoPieceCollision | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const volume = parseCollisionVolume(v.volume);
  const hit = v.hit !== false;
  if (hit && !volume) return null;
  return { hit, ...(volume ? { volume } : {}) };
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
