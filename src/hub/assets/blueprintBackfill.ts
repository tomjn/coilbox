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
 * all the build pics, and one for the models of the units left to draw. A
 * blueprint of twenty buildings asked one unit at a time would be twenty archive
 * mounts, a second or more each on a big game.
 *
 * The models one comes last because it is the one that can be narrowed. The keys
 * and the build pics are asked for the whole layout, and the models only for the
 * units the have check came back wanting, which on a game somebody has already
 * uploaded is usually none at all (issue #1684).
 *
 * The renders themselves are drawn one at a time. Each needs a GL context of its
 * own, and twenty at once is twenty contexts competing for the same GPU rather
 * than twenty renders in the time of one. The encode that follows each one costs
 * no mount, because the key it was named by is handed to it (issue #1720).
 *
 * ## A run with pictures going anywhere says so, and can be stopped
 *
 * A have check is what decides whether anybody hears about the run at all
 * (issue #1686), and there are two of them. The render one here: once it comes
 * back wanting a picture drawn, the run puts itself in the topbar through
 * `./runningUploads`, because drawing is the part that takes a minute. And the
 * upload's own, inside the plugin, which is the first thing that knows how many
 * build pics the hub wants: a run with nothing to draw and pictures to send is
 * minutes of upload on a slow connection, and it announces itself off that number
 * rather than staying silent through the lot (issue #1768).
 *
 * A run neither wants anything from stays silent, which is the ordinary one.
 *
 * That flag is read between renders and again before the upload, so a stop lands
 * in the half the run is actually in rather than only in the upload command.
 * Stopping during the drawing half sends nothing at all: the pictures drawn so
 * far are in this machine's cache, which costs nobody anything.
 *
 * ## There is no map equivalent of this file, and there is not meant to be
 *
 * Nothing in coilbox uploads a map picture. Map assets reach the hub through the
 * seed export in `crates/coilbox-unitsync-worker/src/seed.rs` and through nothing
 * else, which is issue #1685 and section 4.6.1 of the asset pipeline design.
 *
 * The reason is the reason this file is lazy in the first place. A roster has a
 * long tail that only appears when somebody opens a blueprint naming a unit
 * nobody has opened before, so the client has to be able to fill a gap it finds.
 * The map set is fixed at roughly 3,575 archives and has no such tail, so a
 * machine that holds them can seed the lot at once. And a blueprint names its
 * units, whereas a map is opened from the map page, from a battle, from a
 * scenario and from the launcher, none of which means the map is worth a
 * picture.
 */

import {
  type UnitBuildpicsResult,
  type UnitDatasetEntry,
  type UnitModelResult,
  type UnitRenderKey,
  type UnitRenderKeysResult,
  type UnitRenderResult,
  unitsyncUnitBuildpics,
  unitsyncUnitModels,
  unitsyncUnitRender,
  unitsyncUnitRenderKeys,
} from "@/content/bindings";
import { unitModelTextureUrl } from "@/lib/assetUrl";
import { toBase64 } from "@/lib/base64";
import { reportAssetUploadStopped } from "../uploadOutcomes";
import { type AssetKey, assetsTheHubWants, type HaveResult } from "./have";
import { RENDER_VERSION, renderTopDown, type TopDownRender } from "./renderTop";
import {
  hideUploadRun,
  showUploadRun,
  updateUploadRun,
  uploadRunStopping,
} from "./runningUploads";
import { type AssetUpload, uploadAssetsToHub } from "./upload";

/**
 * The one angle that ships (issue #1631). A second angle would double the render
 * corpus, which is already a third of the hub's durable tier at two, so this is a
 * constant rather than an argument: nothing gets to ask for more of them.
 */
export const BACKFILL_ANGLE = "top";

/** Why a run did less than the layout when somebody pressed the button. Not a
 *  sentence anybody is shown: what they are told is in `../uploadOutcomes`. */
const STOPPED_BY_HAND = "Stopped by hand.";

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
  models: typeof unitsyncUnitModels;
  readModel: typeof readCachedModel;
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
  models: unitsyncUnitModels,
  readModel: readCachedModel,
  encodeRender: unitsyncUnitRender,
  draw: renderTopDown,
  ask: assetsTheHubWants,
  upload: uploadAssetsToHub,
};

/**
 * Read back a model the batch wrote into the model-texture cache.
 *
 * Over the asset protocol rather than through the IPC bridge, which is the point
 * of the batch writing files at all: a flattened model is megabytes of floats,
 * and the textures it names are already loaded from this same root.
 */
export async function readCachedModel(file: string): Promise<UnitModelResult> {
  const res = await fetch(unitModelTextureUrl(file));
  if (!res.ok) throw new Error(`could not read model ${file}: ${res.status}`);
  return (await res.json()) as UnitModelResult;
}

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

  // The models of what is left to draw, in one mount rather than one each
  // (issue #1684). Asked for after the have check, so a layout the hub already
  // holds every render of does not mount for models at all.
  const drawing = working.filter((unit) => wanted.has(unit.name));

  // Half the threshold (issue #1686). A run with a picture to draw is about to
  // hold the app for seconds each, so it says so. The other half is the upload's
  // own have check, below: a run with nothing to draw and build pics the hub
  // wants is minutes of upload on a slow connection, and it was invisible until
  // issue #1768.
  const opId = crypto.randomUUID();
  let announced = drawing.length > 0;
  if (announced) {
    showUploadRun({ opId, game: target.game, total: drawing.length });
  }

  try {
    const models = drawing.length
      ? await tools.models({
          ...archive,
          objects: [...new Set(drawing.map((unit) => unit.objectName))],
        })
      : null;

    let rendered = 0;
    let halted = false;
    for (const [at, unit] of drawing.entries()) {
      // Between pictures rather than inside one. A render is seconds, so this
      // lands well inside anybody's patience.
      if (uploadRunStopping(opId)) {
        halted = true;
        break;
      }
      const model = models?.models[unit.objectName];
      // A unit whose model would not read is not a run that stops. The rest of
      // the layout is still worth sending, and its build pic has already gone.
      if (!model) {
        console.warn(
          "no model for",
          unit.name,
          models?.skipped[unit.objectName] ?? "the batch read nothing",
        );
      } else {
        const asset = await renderOne(
          target,
          archive,
          unit,
          model.file,
          keyed.keys[unit.name],
          keyed.sourceArchive,
          tools,
        );
        rendered += 1;
        if (asset) assets.push(asset);
      }
      updateUploadRun(opId, { done: at + 1 });
    }

    // Stopped while drawing means nothing is sent, including the build pics
    // extracted above. They cost a mount and an encode on this machine and
    // nothing anybody shares, so throwing them away is the cheap half of
    // honouring what was asked for.
    if (halted) {
      reportAssetUploadStopped(0, { game: target.game });
      return {
        units: working.length,
        asked: keys.length,
        rendered,
        offered: assets.length,
        written: 0,
        stopped: STOPPED_BY_HAND,
      };
    }

    // A run with nothing to send does not open the door at all. The hub already
    // holding everything is the ordinary answer, not an edge case.
    //
    // Started by coilbox, always. A backfill is the app filling gaps it noticed
    // on its own, so a rejection goes to the console rather than in front of
    // somebody who was reading a layout (issue #1690). If a button ever starts
    // one of these, this is what has to become an argument.
    let written = 0;
    let stoppedSending = false;
    if (assets.length) {
      updateUploadRun(opId, {
        phase: "sending",
        done: 0,
        total: assets.length,
      });
      const run = await tools.upload(target.hubUrl, assets, {
        startedBy: "coilbox",
        opId,
        onProgress: (sample) => {
          // The first moment anybody knows how many pictures are really going
          // (issue #1768). `wanted` is null until the upload's have check has
          // answered and a count from then on, and the first sample carrying one
          // arrives before the first transfer starts, so a run on a slow
          // connection is on screen for the whole of it rather than after it.
          if (!announced && (sample.wanted ?? 0) > 0) {
            announced = true;
            showUploadRun({
              opId,
              game: target.game,
              phase: "sending",
              total: sample.total,
            });
          }
          updateUploadRun(opId, {
            done: sample.done,
            total: sample.total,
            sent: sample.uploaded,
          });
        },
      });
      written = run.written;
      // Read after the run rather than before, because the flag can go up while
      // the upload is in flight and what the report needs is the count that
      // actually reached the hub.
      stoppedSending = uploadRunStopping(opId);
      if (stoppedSending) {
        reportAssetUploadStopped(written, { game: target.game });
      }
    }
    return {
      units: working.length,
      asked: keys.length,
      rendered,
      offered: assets.length,
      written,
      ...(stoppedSending
        ? { stopped: STOPPED_BY_HAND }
        : stopped
          ? { stopped }
          : {}),
    };
  } finally {
    hideUploadRun(opId);
  }
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
 * `modelFile` is what the batch read wrote this unit's model to. A unit that will
 * not draw is not a run that stops: the reasons are all about one unit, and the
 * rest of the layout is still worth sending.
 *
 * `key` is this unit's own row out of the keys call, and handing it to the encode
 * is issue #1720: those three fields are what the encode would otherwise mount the
 * game's archive set to work out, having been worked out a moment ago for exactly
 * this unit at exactly this footprint. Twenty buildings were twenty mounts.
 *
 * The three travel together or not at all, so a key without an archive name, which
 * is what a batch whose mount failed gives, takes the mounting path rather than
 * two thirds of the fast one.
 */
async function renderOne(
  target: BackfillTarget,
  archive: { enginePath: string; dataDir: string; gameArchive: string },
  unit: BackfillUnit,
  modelFile: string,
  key: UnitRenderKey | undefined,
  sourceArchive: string | undefined,
  tools: BackfillTools,
): Promise<AssetUpload | null> {
  try {
    const model = await tools.readModel(modelFile);
    const drawn = await tools.draw(model, unit.footprintX, unit.footprintZ);
    const known =
      key?.modelDigest && key.sourceMember && sourceArchive
        ? {
            modelDigest: key.modelDigest,
            sourceMember: key.sourceMember,
            sourceArchive,
          }
        : {};
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
      ...known,
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
