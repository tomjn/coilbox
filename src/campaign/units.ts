/**
 * Units from the unit builder, attached to a campaign (issue #4516), a
 * conquest or a warpath run (issue #4518). Everything here works on a
 * {@link UnitsOwner}, which a campaign already is.
 *
 * Attaching a unit takes a copy, the way a mission snapshots its preset, so
 * editing the unit in the builder does not change the campaign. The copy is
 * the unit already built: the model, the unit definition, the script and the
 * rest of what a game folder holds for it, plus the source document. It is
 * built once, on attach, with nothing taken from any game, because the game it
 * launches on is chosen mission by mission. A unit with legs or wheels takes its
 * movement class from that game at launch (issue #4542). It carries its atlas only when the
 * atlas is not the bundled one, and the textures of an imported or mixed unit
 * always, so a mission launches without the parts pack.
 *
 * Each mission launches through a mutator written at launch,
 * `coilbox-lego-campaign-<id>.sdd`, against the base game the install gate
 * resolved. Only the folder's own files and the build list depend on that game,
 * so those are the parts made at launch.
 *
 * Singleplayer only: a mutator written on one machine cannot be synced to a
 * lobby.
 *
 * A game's campaign and a bundled one carry their copies inline in the
 * document, and {@link writeCarriedCopies} stores them before anything reads
 * them.
 */

import { select, t } from "@lingui/core/macro";
import { describeError } from "@/i18n/uiError";
import type { GameItem } from "../content/bindings";
import { loadContentState } from "../content/contentState";
import { legoScratchRemove } from "../lego/bindings";
import type { BuiltBy } from "../lego/buildList";
import type { LegoProject } from "../lego/model";
import {
  builtToMove,
  type GameMovementData,
  scratchMovement,
} from "../lego/movement";
import {
  type PreparedUnit,
  prepareUnit,
  writePreparedMutator,
} from "../lego/mutator";
import { type LoadedPack, loadPack } from "../lego/pack";
import { buildPlayerLimitGadget } from "../lego/playerLimit";
import { loadRawGeometryIfAny, type RawGeometry } from "../lego/rawGeometry";
import { footprintSteps, movedUnitDef, renderUnitDef } from "../lego/unitDef";
import { piecesElsewhereRefusal } from "../lego/unitGame";
import { playerLimitFolder, unitsFolder } from "../lib/generatedGames";
import { readStoredSetting } from "../lib/storedSetting";
import type { PlayTarget } from "../play/config";
import { loadUnitDefs } from "../workshop/config";
import { type ModProject, PROJECTS_KEY } from "../workshop/project";
import {
  campaignUnitDelete,
  campaignUnitFileWrite,
  campaignUnitList,
  campaignUnitSave,
  campaignUnitsDelete,
  type UnitsScope,
} from "./bindings";
import { type CampaignUnit, UNIT_FILE } from "./model";

/** Where a set of unit copies is kept: whose they are, and its id. */
export interface UnitsRef {
  /** Absent for a campaign. */
  scope?: UnitsScope;
  id: string;
}

/**
 * Something units are attached to: a campaign, a conquest (by galaxy id) or a
 * warpath run (by run id), with the entries it keeps for its copies.
 */
export interface UnitsOwner extends UnitsRef {
  units?: readonly CampaignUnit[];
}

/** What a campaign stores on disk as its copy of a unit. */
export interface CampaignUnitCopy {
  formatVersion: 1;
  unitName: string;
  projectId: string;
  copiedAt: string;
  /** The builder document as it was when copied, so the unit can be edited again. */
  source: LegoProject;
  /** The unit built into what a game folder holds for it. */
  built: PreparedUnit;
  /**
   * Whether the copy's folder holds the unit's textures. False for a unit on
   * the bundled atlas, which every install of coilbox has.
   */
  carriesTextures: boolean;
}

/** What a unit copy is built from. */
export interface UnitSource {
  project: LegoProject;
  pack: LoadedPack;
  /** The meshes of a unit imported from somebody else's model, if it is one. */
  raw: RawGeometry | null;
  /** The workshop's projects, where a library weapon is read from. */
  workshopProjects: readonly ModProject[];
}

/**
 * Why this unit cannot be attached to the campaign, or null when it can. A unit
 * name is one unit in the game, so a second document using the same name would
 * have its copy overwrite the first.
 */
export function attachRefusal(
  owner: Pick<UnitsOwner, "units">,
  project: LegoProject,
): string | null {
  if (!/^[a-z0-9_]{1,64}$/.test(project.unitName)) {
    const name = project.name;
    return t`${name} has no unit name a game can load. Give it one in the unit builder first.`;
  }
  const taken = (owner.units ?? []).find(
    (u) => u.unitName === project.unitName && u.projectId !== project.id,
  );
  if (!taken) return null;
  const takenName = taken.name;
  const unitName = project.unitName;
  return t`${takenName} is already attached as ${unitName}. Rename one of them in the unit builder.`;
}

/** The entry the campaign document keeps for a copy. */
function entryFor(project: LegoProject, copiedAt: string): CampaignUnit {
  return {
    unitName: project.unitName,
    projectId: project.id,
    name: project.name,
    builtBy: project.builtBy ?? [],
    copiedAt,
  };
}

/**
 * Build the unit and store the owner's copy of it, replacing an earlier copy
 * of the same unit. Answers the entry for the owner's document.
 */
export async function copyUnit(
  owner: UnitsRef,
  { project, pack, raw, workshopProjects }: UnitSource,
  now: string = new Date().toISOString(),
): Promise<CampaignUnit> {
  // No game's weapons or move classes: the copy is the unit as its document
  // describes it, the same on every mission's game.
  const built = await prepareUnit(
    { baseGame: "", workshopProjects, gameWeapons: null, gameMovement: null },
    { project, pack, raw },
  );
  const textures = built.payload.textures;
  // The base pack's atlas has no pack folder, and ships with coilbox.
  const atlas = textures?.atlas?.pack
    ? { pack: textures.atlas.pack, name: textures.atlas.name }
    : null;
  const stored = (textures?.stored ?? []).map((t) => t.key);
  const copy: CampaignUnitCopy = {
    formatVersion: 1,
    unitName: project.unitName,
    projectId: project.id,
    copiedAt: now,
    source: project,
    built,
    carriesTextures: atlas !== null || stored.length > 0,
  };
  await campaignUnitSave({
    campaignId: owner.id,
    ...(owner.scope ? { scope: owner.scope } : {}),
    unitName: project.unitName,
    json: JSON.stringify(copy),
    atlas,
    stored,
  });
  return entryFor(project, now);
}

/**
 * The document with this unit attached, or its entry replaced when it is
 * already attached. An update keeps the unit where it was in the list.
 */
export function withUnit<T extends { units?: CampaignUnit[] }>(
  doc: T,
  unit: CampaignUnit,
): T {
  const units = doc.units ?? [];
  const at = units.findIndex((u) => u.projectId === unit.projectId);
  const next =
    at === -1 ? [...units, unit] : units.map((u, i) => (i === at ? unit : u));
  return { ...doc, units: next };
}

/** The document without this unit's entry. */
export function withoutUnit<T extends { units?: CampaignUnit[] }>(
  doc: T,
  unitName: string,
): T {
  const units = (doc.units ?? []).filter((u) => u.unitName !== unitName);
  return { ...doc, units: units.length > 0 ? units : undefined };
}

/**
 * Copy a unit into the owner. Answers the entry to add to the document, which
 * the caller saves.
 */
export async function attachUnit(
  owner: UnitsOwner,
  source: UnitSource,
  now?: string,
): Promise<CampaignUnit> {
  const refusal = attachRefusal(owner, source.project);
  if (refusal) throw new Error(refusal);
  return copyUnit(owner, source, now);
}

/**
 * Take a fresh copy of an attached unit from the library. This is the only
 * way a copy changes: nothing updates it when the unit is edited.
 *
 * Answers the new entry, and the unit name of a copy left behind when the unit
 * was renamed in the builder since it was copied. The caller removes that copy
 * with `detachCopy` once the document naming the new one is saved.
 */
export async function updateUnit(
  owner: UnitsOwner,
  source: UnitSource,
  now?: string,
): Promise<{ unit: CampaignUnit; replaces: string | null }> {
  const earlier = (owner.units ?? []).find(
    (u) => u.projectId === source.project.id,
  );
  if (!earlier) {
    const name = source.project.name;
    throw new Error(t`${name} is not attached.`);
  }
  const refusal = attachRefusal(owner, source.project);
  if (refusal) throw new Error(refusal);
  const unit = await copyUnit(owner, source, now);
  return {
    unit,
    replaces: earlier.unitName !== unit.unitName ? earlier.unitName : null,
  };
}

/**
 * Remove a unit's copy from disk. Called once the document no longer names it,
 * so a save that fails never leaves a campaign naming a copy that has gone.
 */
export async function detachCopy(
  campaignId: string,
  unitName: string,
  scope?: UnitsScope,
): Promise<void> {
  await campaignUnitDelete({
    campaignId,
    ...(scope ? { scope } : {}),
    unitName,
  });
}

/**
 * Remove the units game a campaign's missions were launched with, from the
 * content root (issue #4543). A campaign that never launched with units has no
 * folder, which is not an error. Throws when the folder could not be removed.
 */
export async function removeUnitsGame(
  campaignId: string,
  dataDir: string,
  scope: UnitsScope = "campaign",
): Promise<void> {
  const folder = unitsFolder(scope, campaignId);
  if (!folder) return;
  await legoScratchRemove({ dataDir, folder });
}

/**
 * Remove everything a conquest or run holds for its units (issue #4518): its
 * copies, and the units game in every content root, since a launch writes it
 * into whichever root the engine of the day uses. Throws when either could not
 * be removed, before the caller deletes the conquest or run, so it can retry.
 */
export async function discardUnits(ref: Required<UnitsRef>): Promise<void> {
  const state = await loadContentState();
  for (const root of state.roots) {
    if (root.exists) await removeUnitsGame(ref.id, root.path, ref.scope);
  }
  await campaignUnitsDelete({ campaignId: ref.id, scope: ref.scope });
}

/** What a library unit is copied from: the document, its pack and meshes. */
export async function unitSourceFor(
  project: LegoProject,
  workshopProjects: readonly ModProject[],
): Promise<UnitSource> {
  return {
    project,
    pack: await loadPack(),
    raw: await loadRawGeometryIfAny(project.id),
    workshopProjects,
  };
}

/**
 * Copy the units a conquest or run begins with (issue #4518), and answer the
 * entries for its document. Any copies an earlier conquest of the same galaxy
 * left are removed first. When one copy fails, those already made are removed
 * too, so a start that fails leaves nothing behind.
 */
export async function carryUnits(
  ref: Required<UnitsRef>,
  projects: readonly LegoProject[],
  now?: string,
): Promise<CampaignUnit[]> {
  const workshopProjects = readStoredSetting<ModProject[]>(PROJECTS_KEY, []);
  await campaignUnitsDelete({ campaignId: ref.id, scope: ref.scope });
  let doc: { units?: CampaignUnit[] } = {};
  try {
    for (const project of projects) {
      const source = await unitSourceFor(project, workshopProjects);
      const unit = await attachUnit({ ...ref, units: doc.units }, source, now);
      doc = withUnit(doc, unit);
    }
  } catch (e) {
    await campaignUnitsDelete({ campaignId: ref.id, scope: ref.scope }).catch(
      () => {},
    );
    throw e;
  }
  return doc.units ?? [];
}

/** Whether the library's document has changed since the campaign copied it. */
export function libraryChanged(
  unit: CampaignUnit,
  project: LegoProject | undefined,
): boolean {
  return !!project && project.updatedAt > unit.copiedAt;
}

/** Read a stored copy, or null when it is not one this version can launch. */
export function parseUnitCopy(json: string): CampaignUnitCopy | null {
  try {
    const copy = JSON.parse(json) as Partial<CampaignUnitCopy> | null;
    if (
      copy?.formatVersion !== 1 ||
      typeof copy.unitName !== "string" ||
      typeof copy.built?.payload?.unitName !== "string" ||
      typeof copy.built.payload.model !== "object"
    ) {
      return null;
    }
    return copy as CampaignUnitCopy;
  } catch {
    return null;
  }
}

/** The text a base64 `data:` URI holds, or null when it will not decode. */
function dataUriText(dataUri: string): string | null {
  try {
    const binary = atob(dataUri.slice(dataUri.indexOf(",") + 1));
    return new TextDecoder().decode(
      Uint8Array.from(binary, (c) => c.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

/**
 * Write one carried copy into its folder, unless the folder already holds the
 * same `unit.json` and the same textures by name.
 */
async function writeCarriedCopy(
  campaignId: string,
  unit: CampaignUnit,
  files: NonNullable<CampaignUnit["files"]>,
  onDisk: { json: string; files: string[] } | undefined,
): Promise<void> {
  const { [UNIT_FILE]: unitFile, ...textures } = files;
  if (unitFile?.kind !== "data") return;
  const names = Object.keys(textures).sort();
  if (
    onDisk &&
    onDisk.json === dataUriText(unitFile.dataUri) &&
    JSON.stringify([...onDisk.files].sort()) === JSON.stringify(names)
  ) {
    return;
  }
  const { unitName, name } = unit;
  try {
    await campaignUnitDelete({ campaignId, unitName });
    // `unit.json` last: a folder without it is not a copy.
    for (const file of [...names, UNIT_FILE]) {
      const ref = files[file];
      if (ref.kind !== "data") continue;
      await campaignUnitFileWrite({
        campaignId,
        unitName,
        file,
        dataUri: ref.dataUri,
      });
    }
  } catch (e) {
    const reason = describeError(e);
    throw new Error(
      t`The campaign's copy of ${name} could not be stored: ${reason}`,
    );
  }
}

/** The write in progress for each campaign, so two never share a folder. */
const carriedWrites = new Map<string, Promise<void>>();

/**
 * Store the unit copies a campaign carries in its own document (issue #5469).
 *
 * A game's campaign and a bundled one are the file Campaign builder exports,
 * read as it is and never imported, so each unit's files are still inline on
 * its entry. A launch reads copies from the campaign's units folder, so they
 * are written there first, the way `ensureCampaignScenarioMedia` writes the
 * dialogue clips. A stored campaign carries no files, and this does nothing
 * for it.
 */
export function writeCarriedCopies(owner: UnitsOwner): Promise<void> {
  const carried = (owner.units ?? []).filter((u) => u.files?.[UNIT_FILE]);
  if (carried.length === 0) return Promise.resolve();
  const write = async () => {
    const { units } = await campaignUnitList({ campaignId: owner.id });
    for (const unit of carried) {
      await writeCarriedCopy(
        owner.id,
        unit,
        unit.files ?? {},
        units.find((u) => u.unitName === unit.unitName),
      );
    }
  };
  const next = (carriedWrites.get(owner.id) ?? Promise.resolve())
    .catch(() => {})
    .then(write);
  carriedWrites.set(owner.id, next);
  return next;
}

/** A stored copy that will read, with its folder and the textures in it. */
export interface StoredCopy {
  copy: CampaignUnitCopy;
  dir: string;
  files: string[];
}

/** Every copy a campaign holds that will read, with the folder it is in. */
export async function loadUnitCopies(
  campaignId: string,
  scope?: UnitsScope,
): Promise<Map<string, StoredCopy>> {
  const { units } = await campaignUnitList({
    campaignId,
    ...(scope ? { scope } : {}),
  });
  const copies = new Map<string, StoredCopy>();
  for (const stored of units) {
    const copy = parseUnitCopy(stored.json);
    if (copy) {
      copies.set(stored.unitName, {
        copy,
        dir: stored.dir,
        files: stored.files,
      });
    }
  }
  return copies;
}

/**
 * The atlas pack a copy depends on because its folder does not hold the
 * atlas, or null. A copy made on this machine always holds it, and so does an
 * import whose file carried it. One whose atlas did not arrive is read from the
 * pack it was built from.
 */
export function atlasPackNeeded(stored: StoredCopy): string | null {
  const atlas = stored.copy.built.payload.textures?.atlas;
  if (!atlas?.pack || stored.files.includes(atlas.name)) return null;
  return atlas.pack;
}

/**
 * The atlas packs a campaign's units need and `installed` lacks, each once.
 * `installed` is the folder names of the atlas packs on this machine.
 */
export function missingAtlasPacks(
  copies: ReadonlyMap<string, StoredCopy>,
  installed: ReadonlySet<string>,
): string[] {
  const missing = new Set<string>();
  for (const stored of copies.values()) {
    const pack = atlasPackNeeded(stored);
    if (pack && !installed.has(pack)) missing.add(pack);
  }
  return [...missing];
}

/**
 * A copy as the mutator writes it. A copy that carries its textures has them
 * read out of its own folder rather than a pack or the store. An atlas the
 * folder does not hold keeps naming its pack, which the engine side reads it
 * from instead.
 */
export function launchedUnit(stored: StoredCopy): PreparedUnit {
  const { copy, dir } = stored;
  const textures = copy.built.payload.textures;
  if (!copy.carriesTextures || !textures) return copy.built;
  return {
    ...copy.built,
    payload: {
      ...copy.built.payload,
      textures: {
        ...textures,
        atlas: textures.atlas && {
          ...textures.atlas,
          pack: atlasPackNeeded(stored) ?? null,
        },
        sourceDir: dir,
      },
    },
  };
}

/** The base game a mission launches on, as the install gate resolved it. */
export interface UnitsBaseGame {
  /** The game's name, as unitsync reports it. */
  name: string;
  /** Its archive, which unitsync is asked about its files by. */
  archive: string;
}

export interface PlayedGame {
  game: GameItem;
  /** Every installed game, so a mutator is matched to the game it builds on. */
  installed: readonly GameItem[];
}

export interface ComposedUnits {
  /** The mutator's name, which the start script asks for. */
  name: string;
  /** A line for each weapon or builder left out, and why. */
  leftOut: string[];
}

/**
 * The base game's units and move definitions, for the build list to check its
 * builders against and for a unit that moves to take a class from. Null when
 * they will not read, which leaves the builders unchecked and the movers
 * without a class rather than stopping the launch.
 */
async function gameMovement(
  target: PlayTarget,
  archive: string,
): Promise<GameMovementData | null> {
  try {
    const defs = await loadUnitDefs(target.enginePath, target.dataDir, archive);
    if (Object.keys(defs.units).length === 0) return null;
    return { units: defs.units, moveDefs: defs.moveDefs };
  } catch {
    return null;
  }
}

/**
 * A copy as it launches on this game. A unit built with legs or wheels and no
 * movement class of its own was stored as a building, because a copy is built
 * with no game. It takes a class from the base game here, chosen the way the
 * Test drawer chooses one, or is left out with the reason when the game has
 * none to give (issue #4542).
 */
function withGameMovement(
  unit: CampaignUnit,
  copy: CampaignUnitCopy,
  launched: PreparedUnit,
  game: GameMovementData | null,
  gameName: string,
): { unit: PreparedUnit; leftOut: string[] } {
  if (!builtToMove(copy.source)) return { unit: launched, leftOut: [] };
  const name = unit.name;
  const stays = (why: string) => ({ unit: launched, leftOut: [why] });
  const def = launched.def;
  if (!def) {
    return stays(
      t`${name} launches as a building: its copy predates movement classes. Update the copy from the unit builder.`,
    );
  }
  if (!game) {
    return stays(
      t`${name} launches as a building: the movement classes of ${gameName} could not be read.`,
    );
  }
  const footprint = Math.max(
    Number(def.footprintx) || 1,
    Number(def.footprintz) || 1,
  );
  const movement = scratchMovement(copy.source, game, gameName, footprint);
  if (!movement) {
    return stays(
      t`${name} launches as a building: ${gameName} has no movement class that suits it.`,
    );
  }
  return {
    unit: {
      ...launched,
      payload: {
        ...launched.payload,
        unitDef: renderUnitDef(
          launched.payload.unitName,
          movedUnitDef(def, movement),
        ),
      },
    },
    leftOut: [],
  };
}

/**
 * Write the owner's units mutator against this base game and have unitsync
 * find it. Null for an owner with no units, which launches as it always did.
 * Throws with a reason a player can act on.
 */
export async function composeUnits(
  owner: UnitsOwner,
  target: PlayTarget,
  base: UnitsBaseGame,
  /** The installed game the battle plays, which `base` may be a mutator over. */
  played: PlayedGame,
  /** Also hold the player to their unlocked units (issue #5005). */
  limitsPlayer = false,
): Promise<ComposedUnits | null> {
  const units = owner.units ?? [];
  if (units.length === 0) return null;
  const scope = owner.scope ?? "campaign";
  const ownerId = owner.id;
  const folder = unitsFolder(scope, ownerId);
  if (!folder) {
    throw new Error(
      select(scope, {
        campaign: `This campaign's id, ${ownerId}, cannot name a game folder, so its units cannot be loaded.`,
        conquest: `This conquest's id, ${ownerId}, cannot name a game folder, so its units cannot be loaded.`,
        warpath: `This warpath's id, ${ownerId}, cannot name a game folder, so its units cannot be loaded.`,
        other: `This run's id, ${ownerId}, cannot name a game folder, so its units cannot be loaded.`,
      }),
    );
  }
  await writeCarriedCopies(owner);
  const copies = await loadUnitCopies(owner.id, owner.scope);
  if (scope === "campaign") {
    const missing = units.filter((u) => !copies.has(u.unitName));
    if (missing.length > 0) {
      const unitNames = missing.map((u) => u.name).join(", ");
      throw new Error(
        t`This campaign has no copy of ${unitNames}. Attach it again from the unit builder. A campaign that came with a game has to be exported again by its author.`,
      );
    }
  }
  const game = await gameMovement(target, base.archive);
  const prepared: PreparedUnit[] = [];
  const movementLeftOut: string[] = [];
  const builtBy: BuiltBy[] = [];
  for (const unit of units) {
    const stored = copies.get(unit.unitName);
    if (!stored) {
      const unitLabel = unit.name;
      throw new Error(
        select(scope, {
          conquest: `This conquest's copy of ${unitLabel} is missing. Attach it again from the unit builder.`,
          warpath: `This warpath's copy of ${unitLabel} is missing. Attach it again from the unit builder.`,
          other: `This run's copy of ${unitLabel} is missing. Attach it again from the unit builder.`,
        }),
      );
    }
    const refusal = piecesElsewhereRefusal(
      stored.copy.source,
      played.game,
      played.installed,
    );
    if (refusal) throw new Error(refusal);
    const moving = withGameMovement(
      unit,
      stored.copy,
      launchedUnit(stored),
      game,
      base.name,
    );
    prepared.push(moving.unit);
    movementLeftOut.push(...moving.leftOut);
    builtBy.push({ unitName: unit.unitName, builtBy: unit.builtBy });
  }
  const result = await writePreparedMutator({
    target,
    baseGame: base.name,
    baseArchive: base.archive,
    workshopProjects: [],
    gameWeapons: null,
    gameMovement: game,
    folder,
    prepared,
    builtBy,
    ...(limitsPlayer
      ? { extras: { playerLimitGadget: buildPlayerLimitGadget() } }
      : {}),
  });
  return {
    name: result.name,
    leftOut: [
      ...prepared.flatMap((unit) => unit.weaponsLeftOut),
      ...movementLeftOut,
      ...result.buildListLeftOut,
    ],
  };
}

/**
 * Write the mutator that limits a warpath's player when the run has no builder
 * units for it to go in with (issue #5005), and answer its name. Throws with a
 * reason a player can act on. The caller stops the launch, because going ahead
 * on the game itself would drop the limit.
 */
export async function composePlayerLimit(
  target: PlayTarget,
  base: UnitsBaseGame,
): Promise<string> {
  const { name } = await writePreparedMutator({
    target,
    baseGame: base.name,
    baseArchive: base.archive,
    workshopProjects: [],
    gameWeapons: null,
    gameMovement: null,
    folder: playerLimitFolder(base.name),
    prepared: [],
    builtBy: [],
    extras: {
      playerLimitGadget: buildPlayerLimitGadget(),
      identity: { name: `${base.name} warpath`, version: "limit" },
    },
  });
  return name;
}
