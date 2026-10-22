import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useRef, useState } from "react";
import { summarizeSubstitutions } from "@/conquest/ai";
import { describeError } from "@/i18n/uiError";
import { reconcileParticipantAis } from "@/play/reconcileAi";
import type { StoredBlueprint } from "../../../blueprint/library";
import {
  cachedBlueprint,
  refreshBlueprints,
  saveBlueprints,
} from "../../../blueprint/store";
import { ChallengeCodeInput } from "../../../challenge/ChallengeCodeInput";
import { identify } from "../../../container/container";
import { rememberCarriedShortname } from "../../../container/shortnames";
import { useUnitsyncScan } from "../../../content/config";
import { ResolveContentGate } from "../../../content/pages/components/ResolveContentDrawer";
import { notify } from "../../../notify/notify";
import { usePreferredTarget, useSkirmishAis } from "../../../play/config";
import { useSkirmishPresets } from "../../../play/presets";
import { aiGameNameForPack } from "../../build";
import { packDecodeErrorMessage } from "../../envelope";
import {
  blueprintsFromPack,
  decodeSetupPack,
  namesForPackPresets,
  requirementsForPack,
  type SetupPackManifest,
} from "../../manifest";

/**
 * "Import a setup pack" (issue #415): paste a pack code, resolve its games
 * and maps through issue #387's `ResolveContentGate` (nothing is applied
 * until every download clears, so a partial failure can't half-apply the
 * pack), then save any bundled blueprints and presets, renaming on a name
 * collision rather than overwriting an existing one.
 */
export function ImportPackForm({
  initialCode,
  onImported,
}: {
  /** A confirmed `coilbox://` import code to prefill and run once (issue #388). */
  initialCode?: string;
  /** Called with the ids of the presets the pack added, which is empty for a
   * pack that bundles none, and the games and maps the pack named regardless
   * of whether it also bundled presets. Lets the caller record what the
   * import produced (issue #1368). */
  onImported?: (
    presetIds: string[],
    content: { games: string[]; maps: string[] },
  ) => void;
}) {
  const { t } = useLingui();
  const { presets, savePreset } = useSkirmishPresets();
  const [pending, setPending] = useState<SetupPackManifest | null>(null);
  // The pack's blueprints as library records, minted once per pack. A failed
  // save is retried from the gate, and the same ids are what let the retry
  // skip the ones already written rather than keep a second copy of them.
  const blueprintRecords = useRef<StoredBlueprint[] | null>(null);

  // Read the target here rather than taking it from the page. A drawer's
  // content is built once, when the button is pressed, so a target passed in as
  // a prop is whatever was known at that moment - null on a page opened before
  // the engine read landed, and null for as long as the drawer stays open
  // (issue #1377).
  const { target, loading: targetLoading } = usePreferredTarget();

  // The pack's game AI list, so a bundled preset's AI picks can be reconciled
  // against the recipient's installed version before saving (#501): a pack is
  // reused across game versions, so an AI the author had may be gone here.
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const aiGameName = pending ? aiGameNameForPack(pending) : undefined;
  const gameArchive = scan.data?.games.find((g) => g.name === aiGameName)
    ?.primaryArchive.name;
  const { ais, loaded: aisLoaded } = useSkirmishAis(
    target?.enginePath,
    target?.dataDir,
    gameArchive,
  );
  // Only reconcile against the pack game's own settled list. Without the game
  // installed (or scanned) `gameArchive` is undefined and this query returns the
  // engine's natives, which would rewrite every bundled preset's AI to a native
  // the game doesn't offer, permanently, at save time.
  const aisReady = !!gameArchive && aisLoaded;

  const importCode = async (code: string) => {
    const result = decodeSetupPack(code);
    if (!result.ok) {
      // Identify the paste so a mystery code gets a specific message: a
      // newer-version warning, or "that's a campaign, not a setup pack",
      // instead of a generic "corrupted" (issue #479).
      const id = identify(code);
      if (id.warnings.length > 0) throw new Error(id.warnings[0]);
      if (id.kind !== "unknown" && id.kind !== "setup-pack") {
        const kind = id.kind;
        throw new Error(t`That code is a coilbox ${kind}, not a setup pack.`);
      }
      throw new Error(packDecodeErrorMessage(result.error));
    }
    // Take the pack's word for the shortname of the build it pins, so a re-share
    // from here carries it on (issue #1383).
    rememberCarriedShortname(identify(code).game);
    blueprintRecords.current = null;
    setPending(result.settings);
  };

  const applyPack = async () => {
    if (!pending) return;
    // Blueprints first, because they are the part that can fail: a throw here
    // reaches the gate's "Try again" before any preset has been saved.
    // Named against the library as it is on disk now rather than as a hook last
    // saw it, because the gate can fire before the library's first read lands.
    if (!blueprintRecords.current) {
      const library = pending.blueprints?.length
        ? await refreshBlueprints()
        : [];
      blueprintRecords.current = blueprintsFromPack(
        library.map((record) => record.layout.name),
        pending,
      );
    }
    const layouts = blueprintRecords.current;
    const unsaved = layouts.filter((r) => !cachedBlueprint(r.id));
    if (unsaved.length > 0) {
      try {
        await saveBlueprints(unsaved);
      } catch (e) {
        const reason = describeError(e);
        throw new Error(t`The blueprints were not all saved: ${reason}`);
      }
    }
    const layoutsAdded = layouts.length
      ? plural(layouts.length, {
          one: "# blueprint added to your library.",
          other: "# blueprints added to your library.",
        })
      : "";

    const bundled = pending.presets ?? [];
    const savedIds: string[] = [];
    if (bundled.length > 0) {
      const names = namesForPackPresets(presets, bundled);
      const allSubs: { from: string; to: string }[] = [];
      bundled.forEach((preset, i) => {
        const { name: _name, ...draft } = preset;
        // Reconcile each bundled preset's AI picks against the installed game's
        // AI list before saving. With no AI list yet (a just-downloaded game the
        // scan hasn't caught up on) this is a no-op and the preset saves as-is,
        // to be reconciled later when it meets the game on the Skirmish page.
        const res = reconcileParticipantAis(draft.participants, ais, aisReady);
        allSubs.push(...res.substitutions);
        savedIds.push(
          savePreset(names[i], { ...draft, participants: res.participants }).id,
        );
      });
      const subNotice = summarizeSubstitutions(allSubs);
      const base = plural(bundled.length, {
        one: "# preset added. Load it from Singleplayer → Presets.",
        other: "# presets added. Load one from Singleplayer → Presets.",
      });
      notify({
        title: t`Setup pack imported`,
        body: [base, subNotice, layoutsAdded].filter(Boolean).join(" "),
        level: "success",
      });
    } else if (layoutsAdded) {
      notify({
        title: t`Setup pack imported`,
        body: layoutsAdded,
        level: "success",
      });
    } else {
      const gameCount = pending.games?.length ?? 0;
      const mapCount = pending.maps?.length ?? 0;
      const gamesText = gameCount
        ? plural(gameCount, { one: "# game", other: "# games" })
        : "";
      const mapsText = mapCount
        ? plural(mapCount, { one: "# map", other: "# maps" })
        : "";
      const ready =
        gamesText && mapsText
          ? t`${gamesText} and ${mapsText} ready.`
          : t`${gamesText || mapsText} ready.`;
      notify({
        title: t`Setup pack imported`,
        body: ready,
        level: "success",
      });
    }
    onImported?.(savedIds, {
      games: (pending.games ?? []).map((g) => g.name),
      maps: pending.maps ?? [],
    });
    blueprintRecords.current = null;
    setPending(null);
  };

  return (
    <>
      <ChallengeCodeInput
        helpText={t`Paste a setup pack code shared by another player to install its games and maps, and add any presets and blueprints it includes.`}
        placeholder={t`Paste a setup pack code…`}
        submitLabel={t`Import setup pack`}
        busyLabel={t`Checking…`}
        initialCode={initialCode}
        onImport={importCode}
      />
      {pending && (
        <ResolveContentGate
          title={pending.title ?? t`Set up this pack`}
          requirements={requirementsForPack(pending)}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={applyPack}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
