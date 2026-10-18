/**
 * Units from the unit builder, attached to a campaign (issue #4516).
 *
 * Attaching a unit takes a copy, the way a mission snapshots its preset, so
 * editing the unit in the builder does not change the campaign. The copy is
 * the unit already built: the model, the unit definition, the script and the
 * rest of what a game folder holds for it, plus the source document. It is
 * built once, on attach, with nothing taken from any game, because the game it
 * launches on is chosen mission by mission. It carries its atlas only when the
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
 */

import { loadUnitsyncUnitDataset } from "../content/config";
import type { BuiltBy } from "../lego/buildList";
import type { LegoProject } from "../lego/model";
import {
  type PreparedUnit,
  prepareUnit,
  writePreparedMutator,
} from "../lego/mutator";
import type { LoadedPack } from "../lego/pack";
import type { RawGeometry } from "../lego/rawGeometry";
import { campaignUnitsFolder } from "../lib/generatedGames";
import type { PlayTarget } from "../play/config";
import type { ModProject } from "../workshop/project";
import {
  campaignUnitDelete,
  campaignUnitList,
  campaignUnitSave,
} from "./bindings";
import type { Campaign, CampaignUnit } from "./model";

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
  campaign: Campaign,
  project: LegoProject,
): string | null {
  if (!/^[a-z0-9_]{1,64}$/.test(project.unitName)) {
    return `${project.name} has no unit name a game can load. Give it one in the unit builder first.`;
  }
  const taken = (campaign.units ?? []).find(
    (u) => u.unitName === project.unitName && u.projectId !== project.id,
  );
  return taken
    ? `${taken.name} is already attached as ${project.unitName}. Rename one of them in the unit builder.`
    : null;
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
 * Build the unit and store the campaign's copy of it, replacing an earlier copy
 * of the same unit. Answers the entry for the campaign document.
 */
export async function copyUnit(
  campaignId: string,
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
    campaignId,
    unitName: project.unitName,
    json: JSON.stringify(copy),
    atlas,
    stored,
  });
  return entryFor(project, now);
}

/**
 * The campaign with this unit attached, or its entry replaced when it is
 * already attached. An update keeps the unit where it was in the list.
 */
export function withUnit(campaign: Campaign, unit: CampaignUnit): Campaign {
  const units = campaign.units ?? [];
  const at = units.findIndex((u) => u.projectId === unit.projectId);
  const next =
    at === -1 ? [...units, unit] : units.map((u, i) => (i === at ? unit : u));
  return { ...campaign, units: next };
}

/** The campaign without this unit's entry. */
export function withoutUnit(campaign: Campaign, unitName: string): Campaign {
  const units = (campaign.units ?? []).filter((u) => u.unitName !== unitName);
  return { ...campaign, units: units.length > 0 ? units : undefined };
}

/**
 * Copy a unit into the campaign. Answers the entry to add to the document,
 * which the caller saves.
 */
export async function attachUnit(
  campaign: Campaign,
  source: UnitSource,
  now?: string,
): Promise<CampaignUnit> {
  const refusal = attachRefusal(campaign, source.project);
  if (refusal) throw new Error(refusal);
  return copyUnit(campaign.id, source, now);
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
  campaign: Campaign,
  source: UnitSource,
  now?: string,
): Promise<{ unit: CampaignUnit; replaces: string | null }> {
  const earlier = (campaign.units ?? []).find(
    (u) => u.projectId === source.project.id,
  );
  if (!earlier) throw new Error(`${source.project.name} is not attached.`);
  const refusal = attachRefusal(campaign, source.project);
  if (refusal) throw new Error(refusal);
  const unit = await copyUnit(campaign.id, source, now);
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
): Promise<void> {
  await campaignUnitDelete({ campaignId, unitName });
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

/** Every copy a campaign holds that will read, with the folder it is in. */
export async function loadUnitCopies(
  campaignId: string,
): Promise<Map<string, { copy: CampaignUnitCopy; dir: string }>> {
  const { units } = await campaignUnitList({ campaignId });
  const copies = new Map<string, { copy: CampaignUnitCopy; dir: string }>();
  for (const stored of units) {
    const copy = parseUnitCopy(stored.json);
    if (copy) copies.set(stored.unitName, { copy, dir: stored.dir });
  }
  return copies;
}

/**
 * A copy as the mutator writes it. A copy that carries its textures has them
 * read out of its own folder rather than a pack or the store.
 */
export function launchedUnit(
  copy: CampaignUnitCopy,
  dir: string,
): PreparedUnit {
  const textures = copy.built.payload.textures;
  if (!copy.carriesTextures || !textures) return copy.built;
  return {
    ...copy.built,
    payload: {
      ...copy.built.payload,
      textures: {
        ...textures,
        atlas: textures.atlas && { ...textures.atlas, pack: null },
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

export interface ComposedUnits {
  /** The mutator's name, which the start script asks for. */
  name: string;
  /** A line for each weapon or builder left out, and why. */
  leftOut: string[];
}

/**
 * The base game's units, keyed by name, for the build list to check its
 * builders against. Null when they will not read, which leaves the builders
 * unchecked rather than stopping the launch.
 */
async function gameUnits(
  target: PlayTarget,
  archive: string,
): Promise<Record<string, Record<string, unknown>> | null> {
  try {
    const dataset = await loadUnitsyncUnitDataset(
      target.enginePath,
      target.dataDir,
      archive,
    );
    if (dataset.units.length === 0) return null;
    return Object.fromEntries(
      dataset.units.map((u) => [u.name.toLowerCase(), {}]),
    );
  } catch {
    return null;
  }
}

/**
 * Write the campaign's units mutator against this base game and have unitsync
 * find it. Null for a campaign with no units, which launches as it always did.
 * Throws with a reason a player can act on.
 */
export async function composeCampaignUnits(
  campaign: Campaign,
  target: PlayTarget,
  base: UnitsBaseGame,
): Promise<ComposedUnits | null> {
  const units = campaign.units ?? [];
  if (units.length === 0) return null;
  const folder = campaignUnitsFolder(campaign.id);
  if (!folder) {
    throw new Error(
      `This campaign's id, ${campaign.id}, cannot name a game folder, so its units cannot be loaded.`,
    );
  }
  const copies = await loadUnitCopies(campaign.id);
  const prepared: PreparedUnit[] = [];
  const builtBy: BuiltBy[] = [];
  for (const unit of units) {
    const stored = copies.get(unit.unitName);
    if (!stored) {
      throw new Error(
        `This campaign's copy of ${unit.name} is missing. Attach it again from the unit builder.`,
      );
    }
    prepared.push(launchedUnit(stored.copy, stored.dir));
    builtBy.push({ unitName: unit.unitName, builtBy: unit.builtBy });
  }
  const known = await gameUnits(target, base.archive);
  const result = await writePreparedMutator({
    target,
    baseGame: base.name,
    baseArchive: base.archive,
    workshopProjects: [],
    gameWeapons: null,
    gameMovement: known ? { units: known, moveDefs: [] } : null,
    folder,
    prepared,
    builtBy,
  });
  return {
    name: result.name,
    leftOut: [
      ...prepared.flatMap((unit) => unit.weaponsLeftOut),
      ...result.buildListLeftOut,
    ],
  };
}
