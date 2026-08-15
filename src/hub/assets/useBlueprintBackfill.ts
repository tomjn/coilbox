/**
 * What makes a blueprint's pictures get sent (issues #1636 and #1679).
 *
 * Opening one layout is the trigger. That is the whole of the laziness: the units
 * a person is actually looking at get offered to the hub and nothing else does,
 * so the shared allowance is spent on pictures somebody wanted rather than on a
 * roster nobody asked for.
 *
 * ## Why opening, and why only once
 *
 * On open rather than on an explicit button, because the switch that permits any
 * of this is already an explicit choice the user made in Settings, and a second
 * button per layout would be asking the same question twice. On open rather than
 * on every edit, because a layout is edited by dragging buildings around and
 * firing per drag would be hundreds of runs for one afternoon's work.
 *
 * Once per layout per session, held in a module-level set. Not on disk: a run
 * that failed because the hub was asleep is worth retrying next launch, and the
 * thing that must survive a restart is the rate limit rather than this.
 *
 * ## Everything that has to be true first
 *
 * The user has agreed to send pictures, there is a hub this session trusts, they
 * are signed in to it, the game is installed and its units are read, it has a
 * modinfo shortname to key pictures on, and the rate limit has room. Any of those
 * missing is a quiet no rather than a message: none of them is news to somebody
 * who was opening a layout to look at it.
 *
 * The consent check here is advisory, and deliberately so. The one that decides
 * is `AssetUploadConsent::check` in the plugin, which reads the setting and the
 * distribution profile off disk on every call. This only saves starting work the
 * plugin would refuse.
 */

import { useEffect, useRef } from "react";
import { rememberedShortname } from "@/container/shortnames";
import type { UnitDatasetEntry } from "@/content/bindings";
import { usePreferredTarget } from "@/play/config";
import { hubAccountSnapshot } from "../account";
import { assetUploadsPermitted } from "../assetUploads";
import { useTrustedHubUrl } from "../config";
import {
  type BackfillReport,
  type BackfillTools,
  backfillBlueprintUnits,
  blueprintBackfillUnits,
} from "./blueprintBackfill";
import { recordBackfillWrites, unitsAffordableNow } from "./budget";

/** The layouts this session has already offered, so opening one twice, or coming
 *  back to it after a detour, is one run. */
const offered = new Set<string>();

/** Forget which layouts have run. For tests, which must not inherit each
 *  other's. */
export function forgetBlueprintBackfills(): void {
  offered.clear();
}

/** What one layout gives this hook. */
export interface BlueprintToBackfill {
  /** The library id, which is what "once per layout" is counted on. */
  id: string;
  buildings: readonly { def: string }[];
  /** The archive name of the game it was drawn for. */
  gameName: string;
  /** The modinfo shortname, when the layout carries one. A layout drawn here
   *  always does, and one shared from a machine that had never read the game's
   *  modinfo does not, which is what the fallback below covers. */
  shortname?: string;
}

/**
 * Offer this layout's units to the hub, once, when everything is ready.
 *
 * Returns nothing. A backfill is a background job with no place on a page about
 * a layout, and what it has to say when it goes wrong is said through the
 * notification path in `../uploadOutcomes` (issue #1634).
 */
export function useBlueprintBackfill(
  blueprint: BlueprintToBackfill | null,
  dataset: readonly UnitDatasetEntry[],
  /** The game's primary archive, from `useGameUnits`. Undefined until the game
   *  is found, which is what says the dataset is not simply empty yet. */
  archive: string | undefined,
  /** For tests, which have neither an archive nor a hub. */
  tools?: BackfillTools,
): void {
  const hubUrl = useTrustedHubUrl();
  const { target } = usePreferredTarget();

  // Held in a ref so a re-render with a new tools object or a new buildings
  // array does not re-run the effect. What decides a run is the layout's id.
  const latest = useRef({ blueprint, dataset, archive, hubUrl, target, tools });
  latest.current = { blueprint, dataset, archive, hubUrl, target, tools };

  const ready = Boolean(
    blueprint && archive && hubUrl && target?.enginePath && dataset.length > 0,
  );
  const id = blueprint?.id ?? "";

  useEffect(() => {
    if (!ready || !id) return;
    let cancelled = false;
    void (async () => {
      const report = await runBlueprintBackfill(latest.current);
      if (!cancelled && report?.stopped) console.info(report.stopped);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, id]);
}

/** Everything a run needs, gathered from hooks by the caller above. */
interface BackfillInputs {
  blueprint: BlueprintToBackfill | null;
  dataset: readonly UnitDatasetEntry[];
  archive: string | undefined;
  hubUrl: string | null;
  target: { enginePath: string; dataDir: string } | null;
  tools?: BackfillTools;
}

/**
 * One run, and the whole of the decision about whether there is one.
 *
 * Split out of the effect so every gate can be asserted without a renderer. Null
 * means nothing ran, and there are several reasons for that which are all
 * ordinary.
 */
export async function runBlueprintBackfill(
  inputs: BackfillInputs,
): Promise<BackfillReport | null> {
  const { blueprint, dataset, archive, hubUrl, target } = inputs;
  if (!blueprint || !archive || !hubUrl || !target?.enginePath) return null;
  if (offered.has(blueprint.id)) return null;
  if (!assetUploadsPermitted()) return null;
  if (!hubAccountSnapshot(hubUrl).signedIn) return null;

  // A game with no shortname in its modinfo cannot key a unit picture, and
  // keying one on the archive name would mint an identity that dies at the next
  // version bump. The engine does not allow a game without one, so this is a
  // broken game rather than an unusual one.
  const game = blueprint.shortname ?? rememberedShortname(blueprint.gameName);
  if (!game) return null;

  const units = blueprintBackfillUnits(blueprint.buildings, dataset);
  if (units.length === 0) return null;

  // Claimed before the run rather than after, so a second render of the page
  // while the first run is still in flight does not start a second one.
  offered.add(blueprint.id);

  const report = await backfillBlueprintUnits(
    {
      hubUrl,
      game,
      archive,
      enginePath: target.enginePath,
      dataDir: target.dataDir,
    },
    units,
    unitsAffordableNow(game),
    inputs.tools,
  );
  recordBackfillWrites(game, report.written);
  return report;
}
