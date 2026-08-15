/**
 * Sending the hub pictures of the units one blueprint names (issue #1636).
 *
 * Backfill is lazy and this is what that means: opening a layout of twelve
 * buildings offers the hub twelve units' pictures, not the five hundred and
 * sixty four Beyond All Reason ships. Nothing here can be pointed at a roster.
 * The unit list is the layout's own `buildings`, deduplicated, and there is no
 * argument that widens it.
 *
 * That matters more than the write volume suggests. Every accepted upload spends
 * a storage operation out of an allowance the whole community shares, and running
 * out is thirty days with no uploads at all and no way to pay through it. A
 * client that walked a roster would spend it for everybody.
 *
 * ## Ask before making anything
 *
 * Renders are the class to be careful with. A build pic is read out of the
 * archive and a whole game's worth is about 20 MB, but a render is drawn from the
 * model and they scale with units times angles. So the have check comes first for
 * them, which is possible at all because `unitsync_unit_render_keys` names a
 * render's identity without drawing it (issue #1672). Only the units it comes
 * back wanting are ever drawn.
 *
 * Build pics cannot be asked about first, because their `source_hash` is over the
 * archive member and reading it out is most of the work of extracting it. They
 * are extracted and encoded locally, which costs nothing anybody shares, and the
 * upload's own have check is what stops them being sent.
 *
 * ## One mount per question
 *
 * Every archive read here is batched: one call for all the render keys, one for
 * all the build pics. A blueprint of twenty buildings asked one unit at a time
 * would be twenty archive mounts, a second or more each on a big game.
 *
 * The renders themselves are drawn one at a time. Each needs the model read out
 * of the archive and a GL context of its own, and twenty at once is twenty
 * contexts competing for the same GPU rather than twenty renders in the time of
 * one.
 */

import {
  type UnitBuildpicsResult,
  type UnitDatasetEntry,
  type UnitModelResult,
  type UnitRenderKeysResult,
  type UnitRenderResult,
  unitsyncUnitBuildpics,
  unitsyncUnitModel,
  unitsyncUnitRender,
  unitsyncUnitRenderKeys,
} from "@/content/bindings";
import { type AssetKey, assetsTheHubWants, type HaveResult } from "./have";
import {
  RENDER_VERSION,
  renderTopDown,
  type TopDownRender,
  toBase64,
} from "./renderTop";
import { type AssetUpload, uploadAssetsToHub } from "./upload";

/**
 * The one angle that ships (issue #1631). A second angle would double the render
 * corpus, which is already a third of the hub's durable tier at two, so this is a
 * constant rather than an argument: nothing gets to ask for more of them.
 */
export const BACKFILL_ANGLE = "top";

/** One unit a blueprint names, with what a render of it needs. */
export interface BackfillUnit {
  /** The internal name, which is what the hub keys a unit picture on. */
  name: string;
  /** The unitdef's `objectname`, which is what the model is found by. */
  objectName: string;
  footprintX: number;
  footprintZ: number;
}

/**
 * The units one layout names, and nothing else (issue #1636).
 *
 * This is the whole of what stops a roster walk, so it is worth being plain about
 * what it is: the layout's own buildings, deduplicated, matched against the
 * dataset. The dataset is only ever read, never enumerated. There is no branch
 * here that produces a unit the layout did not name.
 *
 * Matched case-insensitively, the way the footprint lookup and the known-unit
 * check do, because a layout holds whatever its author's game wrote and the
 * dataset is lowercased.
 *
 * A unit the game has not got is dropped, and so is one with no `objectname`:
 * both would mint a key naming a picture nobody can make. The footprints fall
 * back to one square, which is the floor the engine applies.
 */
export function blueprintBackfillUnits(
  buildings: readonly { def: string }[],
  dataset: readonly UnitDatasetEntry[],
): BackfillUnit[] {
  const known = new Map(dataset.map((unit) => [unit.name.toLowerCase(), unit]));
  const units: BackfillUnit[] = [];
  const seen = new Set<string>();
  for (const building of buildings) {
    const name = building.def?.toLowerCase();
    if (!name || seen.has(name)) continue;
    const unit = known.get(name);
    if (!unit?.objectName) continue;
    seen.add(name);
    units.push({
      name: unit.name,
      objectName: unit.objectName,
      footprintX: Math.max(1, Math.trunc(unit.footprintX ?? 1)),
      footprintZ: Math.max(1, Math.trunc(unit.footprintZ ?? 1)),
    });
  }
  return units;
}

/** Where the pictures come from and where they go. */
export interface BackfillTarget {
  hubUrl: string;
  /**
   * The game's modinfo shortname. Never a version and never an archive name: the
   * key exists to survive a version bump. A game with no shortname cannot key a
   * unit picture at all, so the caller skips it rather than keying on something
   * else.
   */
  game: string;
  /** The primary archive, which is what a worker call is made against. */
  archive: string;
  enginePath: string;
  dataDir: string;
}

/**
 * What a run did, in counts rather than in words.
 *
 * These are what the tests assert on. A blueprint naming twelve units in a game
 * of five hundred and sixty four has to produce twelve of everything, and a count
 * is the only way to say that without inspecting the requests.
 */
export interface BackfillReport {
  /** Units worked on, after the rate limit had its say. */
  units: number;
  /** Keys sent to the have check, which is one per unit that has a model. */
  asked: number;
  /** Renders actually drawn, which is only the ones the hub said it wanted. */
  rendered: number;
  /** Assets handed to the upload, build pics and renders together. */
  offered: number;
  /** Rows the hub now holds these bytes for. */
  written: number;
  /** Why the run did less than the whole blueprint, when it did. */
  stopped?: string;
}

/**
 * Everything this reaches outside itself, so a test can count the calls rather
 * than inspect them. The live set is the bindings themselves.
 */
export interface BackfillTools {
  renderKeys: typeof unitsyncUnitRenderKeys;
  buildpics: typeof unitsyncUnitBuildpics;
  model: typeof unitsyncUnitModel;
  encodeRender: typeof unitsyncUnitRender;
  draw: (
    model: UnitModelResult,
    footprintX: number,
    footprintZ: number,
  ) => Promise<TopDownRender>;
  ask: typeof assetsTheHubWants;
  upload: typeof uploadAssetsToHub;
}

export const liveBackfillTools: BackfillTools = {
  renderKeys: unitsyncUnitRenderKeys,
  buildpics: unitsyncUnitBuildpics,
  model: unitsyncUnitModel,
  encodeRender: unitsyncUnitRender,
  draw: renderTopDown,
  ask: assetsTheHubWants,
  upload: uploadAssetsToHub,
};

/**
 * Offer the hub the pictures of these units, and say what that came to.
 *
 * `affordableUnits` is what the rate limit has left, in units rather than in
 * pictures, and it is applied before anything is read. Applying it here rather
 * than at the upload is the whole point: a limit that trims the list after the
 * renders are drawn has already spent everything the limit exists to save.
 */
export async function backfillBlueprintUnits(
  target: BackfillTarget,
  units: readonly BackfillUnit[],
  affordableUnits: number,
  tools: BackfillTools = liveBackfillTools,
): Promise<BackfillReport> {
  const nothing: BackfillReport = {
    units: 0,
    asked: 0,
    rendered: 0,
    offered: 0,
    written: 0,
  };
  if (units.length === 0) return nothing;
  if (affordableUnits <= 0) {
    return {
      ...nothing,
      stopped: `Coilbox has already sent this hour's pictures for ${target.game}.`,
    };
  }

  const stopped =
    units.length > affordableUnits
      ? `Only ${affordableUnits} of this layout's ${units.length} units fit in this hour's allowance for ${target.game}.`
      : undefined;
  const working = units.slice(0, affordableUnits);

  const archive = {
    enginePath: target.enginePath,
    dataDir: target.dataDir,
    gameArchive: target.archive,
  };

  // One mount, and the answer is what a render will be called rather than a
  // render. Nothing has been drawn at this point and nothing needs to be.
  const keyed = await tools.renderKeys({
    ...archive,
    angle: BACKFILL_ANGLE,
    rendererVersion: RENDER_VERSION,
    units: working.map((unit) => ({
      unit: unit.name,
      object: unit.objectName,
      footprintX: unit.footprintX,
      footprintZ: unit.footprintZ,
    })),
  });

  const keys = renderKeysToAsk(target.game, working, keyed);
  const answers = await tools.ask(target.hubUrl, keys);
  const wanted = new Set(unitsWanted(keys, answers));

  // Extracted rather than drawn, so this costs a mount and an encode and nothing
  // the community shares. The upload's own have check is what stops the ones the
  // hub already holds from being sent.
  const pictures = await tools.buildpics({
    ...archive,
    units: working.map((unit) => unit.name),
    assets: true,
  });

  const assets: AssetUpload[] = buildpicUploads(target.game, working, pictures);

  let rendered = 0;
  for (const unit of working) {
    if (!wanted.has(unit.name)) continue;
    const asset = await renderOne(target, archive, unit, tools);
    rendered += 1;
    if (asset) assets.push(asset);
  }

  // A run with nothing to send does not open the door at all. The hub already
  // holding everything is the ordinary answer, not an edge case.
  const written = assets.length
    ? (await tools.upload(target.hubUrl, assets)).written
    : 0;
  return {
    units: working.length,
    asked: keys.length,
    rendered,
    offered: assets.length,
    written,
    ...(stopped ? { stopped } : {}),
  };
}

/**
 * The keys to ask the hub about, one per unit that got one.
 *
 * A unit the worker skipped gets none. There is nothing to ask about a model
 * coilbox could not read, and a key with no `source_hash` is refused by the have
 * check rather than answered.
 */
export function renderKeysToAsk(
  game: string,
  units: readonly BackfillUnit[],
  keyed: UnitRenderKeysResult,
): AssetKey[] {
  const keys: AssetKey[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const key = keyed.keys[unit.name];
    if (!key?.sourceHash) continue;
    // Two units sharing one model are two pictures, but the same unit twice is
    // one, and the have check refuses a batch that asks about one picture twice.
    if (seen.has(unit.name)) continue;
    seen.add(unit.name);
    keys.push({
      keyed_on: "unit",
      game,
      unit_name: unit.name,
      variant: key.variant,
      source_hash: key.sourceHash,
    });
  }
  return keys;
}

/**
 * The units whose renders are worth drawing, from the answers.
 *
 * Zipped by index, which is what the have check promises: answers come back in
 * the order the keys were given. A short answer means the two cannot be lined up,
 * and lining them up wrongly would draw the wrong pictures, so it draws none.
 */
export function unitsWanted(
  keys: readonly AssetKey[],
  answers: readonly HaveResult[],
): string[] {
  if (answers.length !== keys.length) return [];
  const wanted: string[] = [];
  keys.forEach((key, at) => {
    if (key.keyed_on !== "unit") return;
    if (answers[at].status !== "have") wanted.push(key.unit_name);
  });
  return wanted;
}

/** The build pics that came out, as declarations. A unit the game ships no
 *  picture for, or one coilbox could not read, simply is not here. */
export function buildpicUploads(
  game: string,
  units: readonly BackfillUnit[],
  pictures: UnitBuildpicsResult,
): AssetUpload[] {
  const uploads: AssetUpload[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const asset = pictures.units[unit.name]?.asset;
    if (!asset || seen.has(unit.name)) continue;
    seen.add(unit.name);
    uploads.push({
      keyed_on: "unit",
      game,
      unit_name: unit.name,
      variant: asset.variant,
      source_hash: asset.sourceHash,
      encode_profile: asset.encodeProfile,
      origin: "extracted",
      mime: asset.mime,
      source_archive: asset.sourceArchive,
      path: asset.path,
    });
  }
  return uploads;
}

/**
 * Draw and encode one unit's render, or nothing when it could not be.
 *
 * A unit that will not render is not a run that stops. The reasons are all about
 * one unit, a model the archive does not hold or one the readers will not take,
 * and the rest of the layout is still worth sending.
 */
async function renderOne(
  target: BackfillTarget,
  archive: { enginePath: string; dataDir: string; gameArchive: string },
  unit: BackfillUnit,
  tools: BackfillTools,
): Promise<AssetUpload | null> {
  try {
    const model = await tools.model({ ...archive, object: unit.objectName });
    const drawn = await tools.draw(model, unit.footprintX, unit.footprintZ);
    const encoded: UnitRenderResult = await tools.encodeRender({
      ...archive,
      object: unit.objectName,
      angle: BACKFILL_ANGLE,
      footprintX: unit.footprintX,
      footprintZ: unit.footprintZ,
      rendererVersion: RENDER_VERSION,
      pixels: toBase64(drawn.rgba),
      width: drawn.width,
      height: drawn.height,
    });
    const asset = encoded.asset;
    if (!asset) return null;
    return {
      keyed_on: "unit",
      game: target.game,
      unit_name: unit.name,
      variant: asset.variant,
      source_hash: asset.sourceHash,
      encode_profile: asset.encodeProfile,
      origin: "rendered",
      mime: asset.mime,
      source_archive: asset.sourceArchive,
      path: asset.path,
    };
  } catch (e) {
    console.warn("could not render", unit.name, e);
    return null;
  }
}
