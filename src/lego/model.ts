/**
 * The unit builder's document.
 *
 * TypeScript owns this schema and Rust stores it as an opaque string, the same
 * seam campaigns use. Everything here is pure, so the rules can be tested
 * without a renderer or a filesystem.
 *
 * A piece is either geometry, when it has a `partId`, or empty. Empty pieces
 * are not a coilbox invention: an s3o piece with no vertices is how the format
 * carries hierarchy, and how flares, aim points and build emitters are
 * expressed. They survive export. Anchors derived from a part's bounding box
 * do not, and exist only to snap against.
 */

export const LEGO_SCHEMA_VERSION = 1;

/** Extra snap targets beyond the ones derived from a part's bounding box. */
export interface LegoAnchor {
  id: string;
  name: string;
  position: [number, number, number];
}

export interface LegoPiece {
  id: string;
  /** Lower case, unique, and safe as a Lua local, because scripts use it as one. */
  name: string;
  parentId: string | null;
  /** Null for an empty piece: a hierarchy node, flare, aim point or emitter. */
  partId: string | null;
  /** Relative to the parent piece. */
  position: [number, number, number];
  /** Radians, XYZ euler. Baked into vertices on export, see the plan's D3. */
  rotation: [number, number, number];
  scale: [number, number, number];
  mirror?: boolean;
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
  packId: string;
  packVersion: string;
  createdAt: string;
  updatedAt: string;
  rootPieceId: string;
  pieces: LegoPiece[];
  /** s3o header values. Computed on export unless pinned here. */
  radius?: number;
  height?: number;
  mid?: [number, number, number];
  unitDef?: Record<string, string | number | boolean>;
  notes?: string;
  /** Canned animations applied to this unit, from `animPresets.ts`. */
  animations?: { presetId: string; params: Record<string, number> }[];
  /** Where this unit was last exported, so exporting again does not ask. */
  exportDir?: string;
  /** Whether that export also placed the shared atlas. Defaults to true. */
  exportTexture?: boolean;
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
  now: string;
}): LegoProject {
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: options.id,
    name: options.name,
    unitName: normalisePieceName(options.unitName ?? options.name),
    packId: options.packId,
    packVersion: options.packVersion,
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

  const pieces: LegoPiece[] = [];
  for (const raw of d.pieces) {
    const piece = parsePiece(raw);
    if (!piece) return null;
    pieces.push(piece);
  }
  if (pieces.length === 0) return null;

  const mid = parseVec3(d.mid);
  return {
    schemaVersion: LEGO_SCHEMA_VERSION,
    id: d.id,
    name: d.name,
    unitName:
      typeof d.unitName === "string" ? d.unitName : normalisePieceName(d.name),
    packId: typeof d.packId === "string" ? d.packId : "",
    packVersion: typeof d.packVersion === "string" ? d.packVersion : "",
    createdAt: typeof d.createdAt === "string" ? d.createdAt : "",
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : "",
    rootPieceId: d.rootPieceId,
    pieces,
    ...(typeof d.radius === "number" ? { radius: d.radius } : {}),
    ...(typeof d.height === "number" ? { height: d.height } : {}),
    ...(mid ? { mid } : {}),
    ...(typeof d.unitDef === "object" && d.unitDef !== null
      ? { unitDef: d.unitDef as Record<string, string | number | boolean> }
      : {}),
    ...(typeof d.notes === "string" ? { notes: d.notes } : {}),
    ...(Array.isArray(d.animations)
      ? { animations: d.animations.map(parseApplied).filter((a) => a !== null) }
      : {}),
    ...(typeof d.exportDir === "string" ? { exportDir: d.exportDir } : {}),
    ...(typeof d.exportTexture === "boolean"
      ? { exportTexture: d.exportTexture }
      : {}),
  };
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
    position: parseVec3(p.position) ?? [0, 0, 0],
    rotation: parseVec3(p.rotation) ?? [0, 0, 0],
    scale: parseVec3(p.scale) ?? [1, 1, 1],
    ...(p.mirror === true ? { mirror: true } : {}),
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
