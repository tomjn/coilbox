/**
 * Sending the hub pictures of the units one blueprint names (issue #1636).
 *
 * Backfill is lazy and this is what that means: opening a layout of twelve
 * buildings offers the hub twelve units' pictures, not the five hundred and
 * sixty four Beyond All Reason ships. `blueprintBackfillUnits` takes the
 * layout's own `buildings`, deduplicated, and there is no argument that widens
 * it.
 *
 * That matters more than the write volume suggests. Every accepted upload spends
 * a storage operation out of an allowance the whole community shares, and running
 * out is thirty days with no uploads at all and no way to pay through it. A
 * client that walked a roster on its own would spend it for everybody.
 *
 * Something does walk a roster now, and the distinction is who asked. Pressing
 * the button in Settings runs `./pictureSweep.ts`, which hands
 * `backfillBlueprintUnits` below a whole game's worth (issue #1952). What stays
 * true is that nothing does it unasked: reached without a button, this file only
 * ever sees a layout somebody opened, and only the units on it.
 *
 * ## Ask before making anything
 *
 * Renders are the class to be careful with. A build pic is read out of the
 * archive and a whole game's worth is about 20 MB, but a render is drawn from the
 * model and they scale with units times angles, which is four of them now
 * (issue #1951). So the have check comes first for them, which is possible at all
 * because `unitsync_unit_render_keys` names a render's identity without drawing
 * it (issue #1672). Only the pictures it comes back wanting are ever drawn, and
 * a unit the hub holds three angles of costs one render rather than four.
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
 * ## A game in a loose folder is drawn and never sent
 *
 * A `.sdd` is the format you develop in rather than the format you hand to
 * players, so what is in one is half finished by definition and belongs to
 * whoever is editing it (issue #1890). A run against one draws its renders,
 * encodes them and writes them down exactly as any other run does, because
 * seeing your own work in coilbox is the whole reason for working in a folder.
 * What stops is everything that touches the hub: no have check, no build pic
 * extraction, no upload.
 *
 * The test is on `target.archive`, which is the primary archive's file name, and
 * it is the suffix test `isSdd` applies everywhere else in the app. A rapid pool
 * install is a `.sdp` and is untouched by it.
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
  type LocalRender,
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
import { isSddName } from "@/content/format";
import { unitModelTextureUrl } from "@/lib/assetUrl";
import { toBase64 } from "@/lib/base64";
import {
  reportAssetUploadStopped,
  type UploadInitiator,
} from "../uploadOutcomes";
import { type AssetKey, assetsTheHubWants, type HaveResult } from "./have";
import { localRenders, rememberLocalRender } from "./localRenders";
import { RENDER_VERSION, renderUnit, type UnitRender } from "./renderTop";
import {
  hideUploadRun,
  showUploadRun,
  updateUploadRun,
  uploadRunStopping,
} from "./runningUploads";
import { type AssetUpload, uploadAssetsToHub } from "./upload";
import { RENDER_ANGLES, renderVariant } from "./vocabulary";

/**
 * Every angle the vocabulary lists, which is four (issue #1951).
 *
 * The list is the vocabulary's rather than one written here, because the worker
 * refuses an angle the vocabulary does not name and a second list would be a
 * second thing to keep in step. It is still not an argument: which angles a unit
 * is worth drawing at is a fact about the corpus the whole community shares, not
 * something a caller gets to decide.
 *
 * It used to be one, on the grounds that a second angle would double a class
 * already a third of the durable tier. What overturned that is arithmetic rather
 * than appetite: section 5.1 of the asset pipeline design budgets renders at
 * units times angles, which puts four at about 220 MB inside a 1 GB ceiling.
 */
export const BACKFILL_ANGLES = RENDER_ANGLES;

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
  /**
   * Who to tell when the hub refuses something (issues #1690 and #1952).
   *
   * `coilbox` is a run nobody asked for, and a refusal goes quietly into the
   * bell rather than in front of somebody who was reading a layout. `user` is a
   * run somebody pressed a button for, and they are watching: a refusal they are
   * never shown is a run that looks like it worked.
   *
   * No default, so a caller has to answer. The whole point of the distinction is
   * that it is a decision about the run rather than a property of the work.
   */
  startedBy: UploadInitiator;
  /**
   * Whether to extract and offer build pics, which defaults to yes.
   *
   * `false` is for a caller that has already sent this game's build pics itself
   * and is here for the renders (issue #1953). Extracting them again would be a
   * second mount and a few hundred encodes to produce bytes the hub was handed a
   * moment ago and would answer `have` to.
   */
  buildpics?: boolean;
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
    angle: string,
    model: UnitModelResult,
    footprintX: number,
    footprintZ: number,
  ) => Promise<UnitRender>;
  ask: typeof assetsTheHubWants;
  upload: typeof uploadAssetsToHub;
  /** What this machine has already drawn, from `./localRenders.ts`. */
  held: typeof localRenders;
  /** Write one down, so the next run and every plan can find it. */
  remember: typeof rememberLocalRender;
}

export const liveBackfillTools: BackfillTools = {
  renderKeys: unitsyncUnitRenderKeys,
  buildpics: unitsyncUnitBuildpics,
  models: unitsyncUnitModels,
  readModel: readCachedModel,
  encodeRender: unitsyncUnitRender,
  draw: renderUnit,
  ask: assetsTheHubWants,
  upload: uploadAssetsToHub,
  held: localRenders,
  remember: rememberLocalRender,
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

  // A game in a loose folder is drawn and never sent (issue #1890). Everything
  // below the hub line still happens: the renders are made, encoded, written
  // down and shown, which is the whole reason somebody works in a folder. What
  // stops is the three things that reach the hub, so a run against one asks
  // nothing, extracts no build pics and uploads nothing.
  const loose = isSddName(target.archive);

  // One mount, and the answer is what every angle's render will be called rather
  // than a render. Nothing has been drawn at this point and nothing needs to be.
  const keyed = await tools.renderKeys({
    ...archive,
    angles: [...BACKFILL_ANGLES],
    rendererVersion: RENDER_VERSION,
    units: working.map((unit) => ({
      unit: unit.name,
      object: unit.objectName,
      footprintX: unit.footprintX,
      footprintZ: unit.footprintZ,
    })),
  });

  const keys = renderKeysToAsk(target.game, working, keyed);
  // Nothing to ask about a picture that is not going anywhere, and a have check
  // is itself a request carrying this machine's archive hashes. So a loose
  // folder wants every picture it minted a key for: what the hub holds has no
  // bearing on what this machine still has to draw for itself.
  const asked = loose ? 0 : keys.length;
  const wanted = new Set(
    loose
      ? keys.map(pictureId)
      : picturesWanted(keys, await tools.ask(target.hubUrl, keys)),
  );

  // Extracted rather than drawn, so this costs a mount and an encode and nothing
  // the community shares. The upload's own have check is what stops the ones the
  // hub already holds from being sent.
  //
  // Skipped whole for a loose folder rather than extracted and dropped. The
  // build pic a page shows comes from `useBuildpics` in `@/content/config`,
  // which reads the same archive without asking for an encoded asset, so this
  // call exists only to produce something to upload.
  const assets: AssetUpload[] =
    loose || target.buildpics === false
      ? []
      : buildpicUploads(
          target.game,
          working,
          await tools.buildpics({
            ...archive,
            units: working.map((unit) => unit.name),
            assets: true,
          }),
        );

  // What this machine already drew and the hub still has not got (issue #1724).
  // A run that drew a render and then failed to send it used to draw the whole
  // lot again next time, because the encoded file is named after its own bytes
  // and nothing said which unit it was of.
  //
  // Only a render of the same identity counts: the key was worked out against
  // the archive a moment ago, so a game update is a different `sourceHash` and
  // the old picture is not offered under the new one.
  //
  // One read per angle, because the index answers for one variant at a time.
  // They go together rather than in turn: each is a file read on this machine
  // and none of them waits on the others.
  const held = new Map(
    await Promise.all(
      BACKFILL_ANGLES.map(async (angle) => {
        const variant = renderVariant(angle);
        const renders = await tools.held(
          target.game,
          variant,
          RENDER_VERSION,
          working
            .filter((unit) => wanted.has(`${unit.name}\n${variant}`))
            .map((unit) => unit.name),
          keyed.sourceArchive,
        );
        return [variant, renders] as const;
      }),
    ),
  );
  const already = new Map<string, AssetUpload>();
  for (const unit of working) {
    for (const angle of BACKFILL_ANGLES) {
      const variant = renderVariant(angle);
      const render = held.get(variant)?.get(unit.name.toLowerCase());
      const key = keyed.keys[unit.name]?.[variant];
      if (!render || !key?.sourceHash || render.sourceHash !== key.sourceHash) {
        continue;
      }
      already.set(
        `${unit.name}\n${variant}`,
        heldRenderUpload(target.game, unit.name, render),
      );
    }
  }
  // Still read for a loose folder, because what it answers is which pictures
  // this machine has already drawn, and redrawing those would be the run doing
  // its slowest work twice. Only the offering of them stops.
  if (!loose) assets.push(...already.values());

  // The models of what is left to draw, in one mount rather than one each
  // (issue #1684). Asked for after the have check, so a layout the hub already
  // holds every render of does not mount for models at all.
  //
  // A picture is a unit at an angle, so a unit the hub holds three angles of is
  // one picture of work rather than none and rather than four.
  const drawing: Picture[] = [];
  for (const unit of working) {
    for (const angle of BACKFILL_ANGLES) {
      const variant = renderVariant(angle);
      const id = `${unit.name}\n${variant}`;
      if (wanted.has(id) && !already.has(id)) {
        drawing.push({ unit, angle, variant });
      }
    }
  }

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
          // One entry per model however many angles of it are being drawn, since
          // a model read four times is the same model.
          objects: [...new Set(drawing.map((one) => one.unit.objectName))],
        })
      : null;

    let rendered = 0;
    let halted = false;
    for (const [at, { unit, angle, variant }] of drawing.entries()) {
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
          angle,
          model.file,
          keyed.keys[unit.name]?.[variant],
          keyed.sourceArchive,
          tools,
        );
        rendered += 1;
        // Drawn, encoded and written down above whatever happens here. This is
        // only the offering of it, which a loose folder does not do.
        if (asset && !loose) assets.push(asset);
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
        asked,
        rendered,
        offered: assets.length,
        written: 0,
        stopped: STOPPED_BY_HAND,
      };
    }

    // A run with nothing to send does not open the door at all. The hub already
    // holding everything is the ordinary answer, not an edge case, and so is a
    // loose folder: nothing was put in `assets` for one, so a run against a
    // checkout arrives here empty however many pictures it drew.
    //
    // Reported to whoever started it. A backfill coilbox began on its own puts
    // a rejection in the bell rather than in front of somebody who was reading a
    // layout (issue #1690), and a run somebody pressed a button for is shown to
    // them, because they are waiting on it (issue #1952).
    let written = 0;
    let stoppedSending = false;
    if (assets.length) {
      updateUploadRun(opId, {
        phase: "sending",
        done: 0,
        total: assets.length,
      });
      const run = await tools.upload(target.hubUrl, assets, {
        startedBy: target.startedBy,
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
      asked,
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
 * What names one picture in this run: a unit and the variant it is drawn at.
 *
 * A unit is no longer enough on its own now there are four angles of one
 * (issue #1951), and the two are joined by a newline because neither half can
 * hold one: a unit name comes out of a unitdef and a variant is `render:` and a
 * word from the vocabulary.
 */
function pictureId(key: AssetKey): string {
  return key.keyed_on === "unit" ? `${key.unit_name}\n${key.variant}` : "";
}

/** One picture a run may draw: a unit seen from one angle. */
interface Picture {
  unit: BackfillUnit;
  angle: string;
  /** `render:<angle>`, carried alongside so it is worked out once. */
  variant: string;
}

/**
 * The keys to ask the hub about, one per angle of every unit that got one.
 *
 * A unit the worker skipped gets none at any angle. There is nothing to ask about
 * a model coilbox could not read, and a key with no `source_hash` is refused by
 * the have check rather than answered.
 */
export function renderKeysToAsk(
  game: string,
  units: readonly BackfillUnit[],
  keyed: UnitRenderKeysResult,
): AssetKey[] {
  const keys: AssetKey[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    for (const angle of BACKFILL_ANGLES) {
      const key = keyed.keys[unit.name]?.[renderVariant(angle)];
      if (!key?.sourceHash) continue;
      // Two units sharing one model are two pictures, and so are two angles of
      // one unit, but the same unit at the same angle twice is one: the have
      // check refuses a batch that asks about one picture twice.
      const id = `${unit.name}\n${key.variant}`;
      if (seen.has(id)) continue;
      seen.add(id);
      keys.push({
        keyed_on: "unit",
        game,
        unit_name: unit.name,
        variant: key.variant,
        source_hash: key.sourceHash,
      });
    }
  }
  return keys;
}

/**
 * The pictures worth drawing, from the answers, each named by {@link pictureId}.
 *
 * Zipped by index, which is what the have check promises: answers come back in
 * the order the keys were given. A short answer means the two cannot be lined up,
 * and lining them up wrongly would draw the wrong pictures, so it draws none.
 */
export function picturesWanted(
  keys: readonly AssetKey[],
  answers: readonly HaveResult[],
): string[] {
  if (answers.length !== keys.length) return [];
  const wanted: string[] = [];
  keys.forEach((key, at) => {
    if (key.keyed_on !== "unit") return;
    if (answers[at].status !== "have") wanted.push(pictureId(key));
  });
  return wanted;
}

/**
 * A render this machine already holds, as a declaration the upload takes.
 *
 * The same shape `renderOne` produces, because it is the same picture: the bytes
 * in the file the index named are what a fresh draw of that unit at that
 * footprint would encode to, which is what `sourceHash` matching means.
 *
 * Every field is the record's own rather than anything reconstructed here, which
 * is why the record holds the encode profile: a build that encoded renders
 * differently wrote a different one down, and guessing it would declare the wrong
 * bytes to the hub.
 */
export function heldRenderUpload(
  game: string,
  unit: string,
  render: LocalRender,
): AssetUpload {
  return {
    keyed_on: "unit",
    game,
    unit_name: unit,
    variant: render.variant,
    source_hash: render.sourceHash,
    encode_profile: render.encodeProfile,
    origin: "rendered",
    mime: render.mime,
    source_archive: render.sourceArchive,
    path: render.path,
  };
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
 *
 * This is also the one place holding the encoded file, its identity, its angle and
 * the unit's name together, so it is where the render is written down for a second
 * reader (issue #1724). Before the upload rather than after it, and whether or not
 * one happens: keeping a picture and sending it are two decisions, and only the
 * second is the one the consent switch governs.
 */
async function renderOne(
  target: BackfillTarget,
  archive: { enginePath: string; dataDir: string; gameArchive: string },
  unit: BackfillUnit,
  angle: string,
  modelFile: string,
  key: UnitRenderKey | undefined,
  sourceArchive: string | undefined,
  tools: BackfillTools,
): Promise<AssetUpload | null> {
  try {
    const model = await tools.readModel(modelFile);
    const drawn = await tools.draw(
      angle,
      model,
      unit.footprintX,
      unit.footprintZ,
    );
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
      angle,
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
    await tools.remember(target.game, unit.name, asset);
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
