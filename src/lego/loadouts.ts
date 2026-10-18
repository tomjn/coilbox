/**
 * Several named loadouts of one chassis (#3281).
 *
 * The project's own pieces and fields are always the active loadout, so
 * everything that reads a unit (the viewport, the script, the problems list and
 * export) reads the active one with no change. Every other loadout is parked in
 * `LegoLoadout.content`: its own pieces and its own `LOADOUT_FIELDS`.
 *
 * A piece belongs to the active loadout when it, or a piece above it, has
 * `inLoadout`. Every other piece is the chassis, and stays put when the
 * loadout changes, so an edit to it shows in every loadout. Each operation
 * here returns a new project, so through `edit` each is one undo step.
 */

import { adoptFile, receiptFor, recordExport, samePath } from "./exportRecord";
import {
  type ExportedFile,
  type LegoExport,
  type LegoLoadout,
  type LegoLoadoutContent,
  type LegoPiece,
  type LegoProject,
  LOADOUT_FIELDS,
  normalisePieceName,
  pieceById,
  type StaleExport,
  uniquePieceName,
} from "./model";

/** The ids of the pieces that belong to the active loadout. Empty without
 *  loadouts. */
export function loadoutPieceIds(project: LegoProject): Set<string> {
  const owned = new Set<string>();
  if (!project.loadouts) return owned;
  const byId = new Map(project.pieces.map((piece) => [piece.id, piece]));
  const known = new Map<string, boolean>();
  const isOwned = (piece: LegoPiece, seen: Set<string>): boolean => {
    const cached = known.get(piece.id);
    if (cached !== undefined) return cached;
    if (piece.id === project.rootPieceId || seen.has(piece.id)) return false;
    seen.add(piece.id);
    const parent = piece.parentId ? byId.get(piece.parentId) : undefined;
    const answer =
      piece.inLoadout === true || (parent ? isOwned(parent, seen) : false);
    known.set(piece.id, answer);
    return answer;
  };
  for (const piece of project.pieces) {
    if (isOwned(piece, new Set())) owned.add(piece.id);
  }
  return owned;
}

/** Every piece parked in a loadout that is not active, for the checks that
 *  must see the whole family and not only the loadout on screen. */
export function parkedPieces(project: LegoProject): LegoPiece[] {
  return (project.loadouts ?? []).flatMap(
    (loadout) => loadout.content?.pieces ?? [],
  );
}

/** The active loadout's own pieces and fields, ready to park. */
function park(project: LegoProject): LegoLoadoutContent {
  const owned = loadoutPieceIds(project);
  const content: LegoLoadoutContent = {
    pieces: project.pieces.filter((piece) => owned.has(piece.id)),
  };
  for (const field of LOADOUT_FIELDS) {
    if (project[field] !== undefined)
      Object.assign(content, { [field]: project[field] });
  }
  return content;
}

/**
 * The chassis of `project` with `content` on it.
 *
 * A parked piece whose chassis parent was deleted while it was away goes on the
 * root, free, rather than being lost. One whose name the chassis took meanwhile
 * is renamed, because a script addresses pieces by name. Each piece the
 * content hangs off the chassis is flagged, so it is parked again next time.
 */
function restore(
  project: LegoProject,
  content: LegoLoadoutContent,
): LegoProject {
  const owned = loadoutPieceIds(project);
  const chassis = project.pieces.filter((piece) => !owned.has(piece.id));
  const chassisIds = new Set(chassis.map((piece) => piece.id));
  const incoming = content.pieces.filter((piece) => !chassisIds.has(piece.id));
  const incomingIds = new Set(incoming.map((piece) => piece.id));
  const taken = chassis.map((piece) => piece.name);

  const restored = incoming.map((piece) => {
    const name = uniquePieceName(piece.name, taken);
    taken.push(name);
    const underOwn = piece.parentId !== null && incomingIds.has(piece.parentId);
    if (underOwn) return name === piece.name ? piece : { ...piece, name };
    const { connection: _join, ...free } = piece;
    const parentId =
      piece.parentId !== null && chassisIds.has(piece.parentId)
        ? piece.parentId
        : project.rootPieceId;
    return {
      ...(parentId === piece.parentId ? piece : free),
      name,
      parentId,
      inLoadout: true as const,
    };
  });

  const next: LegoProject = { ...project, pieces: [...chassis, ...restored] };
  for (const field of LOADOUT_FIELDS) {
    delete next[field];
    if (content[field] !== undefined)
      Object.assign(next, { [field]: content[field] });
  }
  return next;
}

/**
 * The project with loadout `id` active: the active one's own pieces and fields
 * parked, and `id`'s brought out onto the chassis. The same project when `id`
 * is already active or is not a loadout of it. Also how anything that needs
 * another loadout as a whole unit, such as an export of each, gets one.
 */
export function switchLoadout(project: LegoProject, id: string): LegoProject {
  const loadouts = project.loadouts;
  if (!loadouts || id === project.activeLoadout) return project;
  const target = loadouts.find((loadout) => loadout.id === id);
  if (!target?.content) return project;
  const parked = park(project);
  return {
    ...restore(project, target.content),
    loadouts: loadouts.map((loadout) =>
      loadout.id === project.activeLoadout
        ? { ...loadout, content: parked }
        : loadout.id === id
          ? withoutContent(loadout)
          : loadout,
    ),
    activeLoadout: id,
  };
}

function withoutContent(loadout: LegoLoadout): LegoLoadout {
  const { content: _parked, ...entry } = loadout;
  return entry;
}

/** A unit without loadouts becomes one with a single loadout of what it has,
 *  so the operations below can add to it. */
function withFirstLoadout(
  project: LegoProject,
  newId: () => string,
): LegoProject & { loadouts: LegoLoadout[]; activeLoadout: string } {
  if (project.loadouts && project.activeLoadout)
    return project as LegoProject & {
      loadouts: LegoLoadout[];
      activeLoadout: string;
    };
  const id = newId();
  return {
    ...project,
    loadouts: [{ id, name: "Loadout 1" }],
    activeLoadout: id,
  };
}

function freeName(
  loadouts: LegoLoadout[],
  base: string,
  first: number,
): string {
  const taken = new Set(loadouts.map((loadout) => loadout.name));
  if (first === 0 && !taken.has(base)) return base;
  for (let n = Math.max(first, 2); ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Add a loadout of the bare chassis and switch to it. It starts with the
 * active loadout's animations, unit definition and build settings, but not its
 * own pieces and not a script taken over by hand, which names those pieces.
 */
export function addLoadout(
  project: LegoProject,
  options: { newId: () => string; name?: string },
): LegoProject {
  const base = withFirstLoadout(project, options.newId);
  const { pieces: _own, script: _script, ...settings } = park(base);
  const id = options.newId();
  const name =
    options.name?.trim() ||
    freeName(base.loadouts, "Loadout", base.loadouts.length + 1);
  return switchLoadout(
    {
      ...base,
      loadouts: [
        ...base.loadouts,
        { id, name, content: { pieces: [], ...settings } },
      ],
    },
    id,
  );
}

/** Copy the active loadout, its own pieces included, next to it and switch to
 *  the copy. The copy's pieces keep their ids, which never meet because only
 *  one loadout is on the chassis at a time. */
export function duplicateLoadout(
  project: LegoProject,
  options: { newId: () => string },
): LegoProject {
  const base = withFirstLoadout(project, options.newId);
  const at = base.loadouts.findIndex((l) => l.id === base.activeLoadout);
  const id = options.newId();
  const copy: LegoLoadout = {
    id,
    name: freeName(base.loadouts, `${base.loadouts[at].name} copy`, 0),
    content: park(base),
  };
  return switchLoadout(
    {
      ...base,
      loadouts: [
        ...base.loadouts.slice(0, at + 1),
        copy,
        ...base.loadouts.slice(at + 1),
      ],
    },
    id,
  );
}

export function renameLoadout(
  project: LegoProject,
  id: string,
  name: string,
): LegoProject {
  const trimmed = name.trim();
  const loadouts = project.loadouts;
  if (!loadouts || trimmed === "") return project;
  if (!loadouts.some((l) => l.id === id && l.name !== trimmed)) return project;
  return {
    ...project,
    loadouts: loadouts.map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
  };
}

/**
 * Delete loadout `id` and its own pieces. The active one is left for the one
 * above it, or below it when it is first. With one loadout left the unit has
 * none, and is a plain unit of what that loadout had.
 */
export function deleteLoadout(project: LegoProject, id: string): LegoProject {
  const loadouts = project.loadouts;
  const at = loadouts?.findIndex((l) => l.id === id) ?? -1;
  if (!loadouts || at < 0) return project;
  const switched =
    id === project.activeLoadout
      ? switchLoadout(project, loadouts[at > 0 ? at - 1 : 1].id)
      : project;
  // A loadout upgrading from the deleted one upgrades from what it did, so the
  // chain closes up rather than breaking in two.
  const gone = loadouts[at];
  const left = (switched.loadouts ?? [])
    .filter((l) => l.id !== id)
    .map((l) => {
      if (l.upgradesFrom !== id) return l;
      const { upgradesFrom: _was, ...rest } = l;
      return gone.upgradesFrom
        ? { ...rest, upgradesFrom: gone.upgradesFrom }
        : rest;
    });
  // The files a loadout wrote stay in the game when it goes. Its receipts move
  // to the leftovers, where the export drawer offers to remove what coilbox
  // can prove it wrote.
  const retired = left.length >= 2 ? [gone] : [gone, ...left];
  const staleExports = retired.reduce(
    (list, loadout) =>
      withReceipts(list, [
        loadout.exported,
        ...(loadout.exportedElsewhere ?? []),
      ]),
    switched.staleExports ?? [],
  );
  const kept = staleExports.length > 0 ? { staleExports } : {};
  if (left.length >= 2) return { ...switched, ...kept, loadouts: left };
  const { loadouts: _loadouts, activeLoadout: _active, ...plain } = switched;
  return {
    ...plain,
    ...kept,
    pieces: plain.pieces.map(({ inLoadout: _flag, ...piece }) => piece),
  };
}

/**
 * Make a piece and everything under it the active loadout's own (`own`), or
 * share it with every loadout as part of the chassis.
 *
 * Making a shared piece a loadout's own gives every other loadout a copy, so
 * nothing disappears from a loadout that was showing it. Sharing one drops the
 * other loadouts' copies of it, by id, since the chassis now draws it for all
 * of them. A piece under another loadout piece goes with its parent, so only
 * a piece hanging straight off the chassis can change.
 */
export function setInLoadout(
  project: LegoProject,
  pieceId: string,
  own: boolean,
): LegoProject {
  const loadouts = project.loadouts;
  const piece = pieceById(project, pieceId);
  if (!loadouts || !piece || pieceId === project.rootPieceId) return project;
  const owned = loadoutPieceIds(project);
  if (piece.parentId && owned.has(piece.parentId)) return project;
  if (owned.has(pieceId) === own) return project;

  const subtree = new Set<string>([pieceId]);
  for (const p of project.pieces) {
    // Pieces are kept parent first, so one pass finds the whole subtree.
    if (p.parentId && subtree.has(p.parentId)) subtree.add(p.id);
  }
  const pieces = project.pieces.map((p) => {
    if (p.id === pieceId && own) return { ...p, inLoadout: true as const };
    if (!own && subtree.has(p.id) && p.inLoadout) {
      const { inLoadout: _flag, ...shared } = p;
      return shared;
    }
    return p;
  });
  const copies = pieces.filter((p) => subtree.has(p.id));
  return {
    ...project,
    pieces,
    loadouts: loadouts.map((loadout) => {
      if (!loadout.content) return loadout;
      const parked = loadout.content.pieces;
      const next = own
        ? [
            ...parked,
            ...copies.filter((p) => !parked.some((x) => x.id === p.id)),
          ]
        : parked.filter((p) => !subtree.has(p.id));
      return { ...loadout, content: { ...loadout.content, pieces: next } };
    }),
  };
}

/**
 * Give the active loadout the module instances just dropped onto the chassis,
 * by the root pieces the insert answered. A drop while there are loadouts is
 * a drop into the loadout on screen. Plain parts stay chassis.
 */
export function claimForLoadout(
  project: LegoProject,
  rootPieceIds: string[],
): LegoProject {
  if (!project.loadouts) return project;
  const owned = loadoutPieceIds(project);
  const claim = new Set(
    rootPieceIds.filter((id) => {
      const piece = pieceById(project, id);
      return (
        piece?.module !== undefined &&
        id !== project.rootPieceId &&
        !owned.has(id)
      );
    }),
  );
  if (claim.size === 0) return project;
  return {
    ...project,
    pieces: project.pieces.map((p) =>
      claim.has(p.id) ? { ...p, inLoadout: true as const } : p,
    ),
  };
}

/** The leftovers with every one of `receipts` added, unless one for that
 *  folder and name is there already. */
function withReceipts(
  list: StaleExport[],
  receipts: (LegoExport | undefined)[],
): StaleExport[] {
  const out = [...list];
  for (const receipt of receipts) {
    if (!receipt) continue;
    const there = out.some(
      (s) => samePath(s.dir, receipt.dir) && s.unitName === receipt.unitName,
    );
    if (!there)
      out.push({
        dir: receipt.dir,
        at: receipt.at,
        unitName: receipt.unitName,
        files: receipt.files,
      });
  }
  return out;
}

/**
 * The name each loadout exports under, by loadout id. Empty for a unit without
 * loadouts, which exports under its own name.
 *
 * A name the game maker chose is used as chosen, cleaned to a Spring unit name:
 * lower case, with letters, digits and underscores only. The others are the
 * unit name and the loadout name joined by an underscore and cleaned the same
 * way, so "Light" on `armpw` is `armpw_light`. Names are unique among the
 * loadouts. Chosen names are settled first, in loadout order, and a name that
 * is already taken gets the smallest number after it, so `armpw_light` taken
 * makes the next `armpw_light2`.
 */
export function loadoutUnitNames(project: LegoProject): Map<string, string> {
  const names = new Map<string, string>();
  const loadouts = project.loadouts ?? [];
  const take = (loadout: LegoLoadout, raw: string) =>
    names.set(loadout.id, uniquePieceName(raw, names.values()));
  for (const loadout of loadouts) {
    if (loadout.unitName) take(loadout, loadout.unitName);
  }
  for (const loadout of loadouts) {
    if (!loadout.unitName) take(loadout, `${project.unitName}_${loadout.name}`);
  }
  return names;
}

/** Name loadout `id` for export, or go back to the joined name for an empty one. */
export function setLoadoutUnitName(
  project: LegoProject,
  id: string,
  name: string,
): LegoProject {
  const loadouts = project.loadouts;
  const cleaned = name.trim() === "" ? undefined : normalisePieceName(name);
  if (!loadouts?.some((l) => l.id === id && l.unitName !== cleaned))
    return project;
  return {
    ...project,
    loadouts: loadouts.map((l) => {
      if (l.id !== id) return l;
      const { unitName: _old, ...rest } = l;
      return cleaned ? { ...rest, unitName: cleaned } : rest;
    }),
  };
}

/**
 * Loadout `id` as the whole unit the exporter takes: its pieces and fields on
 * the chassis, its own export name and its own receipts in place of the
 * project's. Null when `id` is not a loadout of the project.
 *
 * The in game name is the unit's and the loadout's joined, so the units a game
 * lists are told apart.
 */
export function loadoutUnit(
  project: LegoProject,
  id: string,
): LegoProject | null {
  const entry = project.loadouts?.find((l) => l.id === id);
  const unitName = loadoutUnitNames(project).get(id);
  if (!entry || !unitName) return null;
  const {
    exported: _latest,
    exportedElsewhere: _others,
    ...unit
  } = switchLoadout(project, id);
  return {
    ...unit,
    name: `${project.name} ${entry.name}`,
    unitName,
    ...(entry.exported ? { exported: entry.exported } : {}),
    ...(entry.exportedElsewhere
      ? { exportedElsewhere: entry.exportedElsewhere }
      : {}),
  };
}

/** Put the export of loadout `id` on record, leaving every other loadout's
 *  receipts as they were. Names it stopped using join the project's leftovers. */
export function recordLoadoutExport(
  project: LegoProject,
  id: string,
  next: Omit<LegoExport, "files">,
  written: ExportedFile[],
): LegoProject {
  if (!project.loadouts?.some((l) => l.id === id)) return project;
  const settled = settleProjectReceipts(project, next.dir);
  const entry = settled.loadouts?.find((l) => l.id === id) as LegoLoadout;
  project = settled;
  const record = recordExport(
    {
      exported: entry.exported,
      exportedElsewhere: entry.exportedElsewhere,
      staleExports: project.staleExports,
    },
    next,
    written,
  );
  return {
    ...project,
    staleExports: record.staleExports,
    loadouts: (project.loadouts ?? []).map((l) =>
      l.id === id
        ? {
            ...l,
            exported: record.exported,
            ...(record.exportedElsewhere.length > 0
              ? { exportedElsewhere: record.exportedElsewhere }
              : {}),
          }
        : l,
    ),
  };
}

/** Say a file in `dir` is coilbox's, for loadout `id` only. */
export function adoptLoadoutFile(
  project: LegoProject,
  id: string,
  dir: string,
  file: ExportedFile,
): LegoProject {
  const loadouts = project.loadouts;
  if (!loadouts?.some((l) => l.id === id)) return project;
  return {
    ...project,
    loadouts: loadouts.map((l) => {
      if (l.id !== id) return l;
      const { exported, exportedElsewhere } = adoptFile(l, dir, file);
      return {
        ...l,
        ...(exported ? { exported } : {}),
        ...(exportedElsewhere ? { exportedElsewhere } : {}),
      };
    }),
  };
}

/** One unit an export writes: the project itself, or one of its loadouts. */
export interface ExportTarget {
  /** Null for a unit without loadouts. */
  loadoutId: string | null;
  unit: LegoProject;
}

/**
 * The units an export writes. A unit without loadouts is the project itself,
 * the same object, so it exports exactly as it did before loadouts. With
 * loadouts it is the active one or every one, each as `loadoutUnit` gives it.
 */
export function exportTargets(
  project: LegoProject,
  which: "active" | "all",
): ExportTarget[] {
  const loadouts = project.loadouts;
  if (!loadouts) return [{ loadoutId: null, unit: project }];
  return loadouts
    .filter((l) => which === "all" || l.id === project.activeLoadout)
    .flatMap((l) => {
      const unit = loadoutUnit(project, l.id);
      return unit ? [{ loadoutId: l.id, unit }] : [];
    });
}

/**
 * The project's own receipts for `dir`, from before it had loadouts, dealt with
 * as a loadout is exported into that folder (#3282).
 *
 * A receipt whose name a loadout now exports under goes to that loadout, unless
 * it has a receipt for the folder already, so the files carry on being its own.
 * Any other is a name nothing exports under any more, so it joins the leftovers
 * and the export drawer offers to remove what coilbox wrote. Either way the
 * project stops holding it.
 */
function settleProjectReceipts(project: LegoProject, dir: string): LegoProject {
  const names = loadoutUnitNames(project);
  const old = [project.exported, ...(project.exportedElsewhere ?? [])].filter(
    (receipt): receipt is LegoExport =>
      receipt !== undefined && samePath(receipt.dir, dir),
  );
  if (old.length === 0) return project;
  let loadouts = project.loadouts ?? [];
  let staleExports = project.staleExports ?? [];
  for (const receipt of old) {
    const owner = loadouts.find((l) => names.get(l.id) === receipt.unitName);
    if (!owner) {
      staleExports = withReceipts(staleExports, [receipt]);
      continue;
    }
    if (receiptFor(owner, dir)) continue;
    loadouts = loadouts.map((l) =>
      l.id !== owner.id
        ? l
        : l.exported
          ? {
              ...l,
              exportedElsewhere: [...(l.exportedElsewhere ?? []), receipt],
            }
          : { ...l, exported: receipt },
    );
  }
  const { exported: _latest, exportedElsewhere: _others, ...rest } = project;
  const elsewhere = (project.exportedElsewhere ?? []).filter(
    (receipt) => !samePath(receipt.dir, dir),
  );
  const latest =
    project.exported && !samePath(project.exported.dir, dir)
      ? project.exported
      : undefined;
  return {
    ...rest,
    ...(latest ? { exported: latest } : {}),
    ...(elsewhere.length > 0 ? { exportedElsewhere: elsewhere } : {}),
    ...(staleExports.length > 0 ? { staleExports } : {}),
    loadouts,
  };
}
