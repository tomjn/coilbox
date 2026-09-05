import { Button } from "@picoframe/frame";
import { Download, Loader2, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MapDownloadHint } from "../../../campaign/model";
import { invalidateMapPreview, invalidateScans } from "../../../content/config";
import { ErrorBanner } from "../../../content/pages/components/states";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { usePreferredTarget } from "../../../play/config";
import type { SkirmishDraft } from "../../../play/drafts";
import { SaveAsPresetButton } from "../../../play/pages/components/SaveAsPresetButton";
import type { BattleRequirement } from "../../../play/useBattleRun";
import { BackToMapButton } from "./BackToMapButton";
import { HUD_CARD_CLASS } from "./hudChrome";

/**
 * The parts conquest's `BattleOverlay` and warpath's `EncounterOverlay` render
 * identically (issue #2441): the back-and-save gutter, the launch gate that
 * walks noEngine, missing content, ready, then not-ready, and the two static
 * phases either side of a launch (checking, and the manual outcome prompt).
 * Both overlays are driven by the same `useBattleRun` (see `play/useBattleRun`),
 * so the props here are exactly the fields of its return value the presentation
 * needs. Nothing overlay-specific like the briefing rows or the outcome
 * messaging lives here, because those genuinely differ and stay in each caller.
 *
 * Lives under conquest because runlite already imports conquest overlay chrome
 * (`BackToMapButton`, `hudChrome`). The reverse would be a cycle.
 */

/**
 * The gutter to the card's left: a back-to-map button, then (once a game is
 * resolved) a "save this fight as a preset" button below it. `extra` renders
 * further down the same gutter column for a caller-specific control (conquest's
 * read-only tech tree button).
 */
export function BattleGutter({
  onClose,
  installedGame,
  getDraft,
  defaultName,
  extra,
}: {
  onClose: () => void;
  /** Whether the launch target resolved to an installed game. The preset
   * button needs one to build a draft from. */
  installedGame: boolean;
  getDraft: () => SkirmishDraft | null;
  defaultName: string;
  extra?: ReactNode;
}) {
  return (
    <>
      <BackToMapButton
        onClick={onClose}
        className="absolute right-full top-0 mr-4"
      />
      {installedGame && (
        <SaveAsPresetButton
          appearance="gutter"
          getDraft={getDraft}
          defaultName={defaultName}
          className={`absolute right-full top-16 mr-4 ${HUD_CARD_CLASS}`}
        />
      )}
      {extra}
    </>
  );
}

/** The battle-in-progress notice while the replay is being read for an outcome. */
export function BattleCheckingNotice() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      Reading the battle report…
    </div>
  );
}

/** The manual Victory/Defeat prompt shown when the replay's outcome is ambiguous. */
export function BattleResultPrompt({
  error,
  saving,
  onVictory,
  onDefeat,
}: {
  error?: string | null;
  saving: boolean;
  onVictory: () => void;
  onDefeat: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBanner message={error} />}
      <p className="text-sm text-muted-foreground">
        The outcome could not be read from the replay. How did the battle end?
      </p>
      <div className="flex gap-2">
        <Button disabled={saving} onClick={onVictory}>
          Victory
        </Button>
        <Button variant="outline" disabled={saving} onClick={onDefeat}>
          Defeat
        </Button>
      </div>
    </div>
  );
}

/** Install gate: a missing map downloads inline. A missing game links to the
 * Downloads page instead, since a game is a bigger decision than a map fetch. */
function MissingContentGate({
  missing,
  mapName,
  mapDownload,
  onRecheck,
}: {
  missing: BattleRequirement;
  mapName: string;
  mapDownload?: MapDownloadHint;
  onRecheck: () => void | Promise<void>;
}) {
  const { target } = usePreferredTarget();
  const mapDl = useQueuedDownload({
    kind: "map",
    label: `Map: ${mapName}`,
    args: {
      springName: mapDownload?.springName ?? mapName,
      searchUrl: mapDownload?.searchUrl,
    },
  });
  const downloading = mapDl.busy;

  const download = async () => {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    invalidateScans();
    if (target?.enginePath && target?.dataDir && mapName) {
      invalidateMapPreview(target.enginePath, target.dataDir, mapName);
    }
    await onRecheck();
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {missing.kind === "map" ? "Map" : "Game"} not installed:{" "}
        <span className="text-foreground">{missing.name}</span>
      </p>
      {mapDl.error && <ErrorBanner message={mapDl.error} />}
      {missing.kind === "map" ? (
        <>
          <Button onClick={download} disabled={downloading} className="w-full">
            <Download className="mr-1.5 size-4" aria-hidden />
            {mapDl.status === "queued"
              ? "Waiting for a slot…"
              : downloading
                ? "Downloading…"
                : "Download map"}
          </Button>
          <QueueProgress item={mapDl} />
        </>
      ) : (
        <Link to="/downloads/games">
          <Button variant="outline" className="w-full">
            <Download className="mr-1.5 size-4" aria-hidden /> Open game
            downloads
          </Button>
        </Link>
      )}
    </div>
  );
}

/**
 * The briefing's launch gate: an install engine prompt, then the missing
 * content gate, then a launch button once ready, then a disabled button
 * explaining why not (running, scanning, no AI, or still preparing). The same
 * ladder both overlays walk before `start()` is reachable.
 */
export function BattleLaunchGate({
  error,
  noEngine,
  missing,
  canStart,
  running,
  scanLoading,
  aisAvailable,
  onStart,
  mapName,
  mapDownload,
  onRecheck,
}: {
  error?: string | null;
  noEngine: boolean;
  missing: BattleRequirement | null;
  canStart: boolean;
  running: boolean;
  scanLoading: boolean;
  aisAvailable: boolean;
  onStart: () => void;
  mapName: string;
  mapDownload?: MapDownloadHint;
  onRecheck: () => void | Promise<void>;
}) {
  return (
    <>
      {error && <ErrorBanner message={error} />}
      {noEngine ? (
        <p className="text-sm text-muted-foreground">
          Install an engine first (
          <Link className="underline underline-offset-4" to="/settings/engines">
            Settings → Engines
          </Link>
          ).
        </p>
      ) : missing ? (
        <MissingContentGate
          missing={missing}
          mapName={mapName}
          mapDownload={mapDownload}
          onRecheck={onRecheck}
        />
      ) : canStart ? (
        <Button onClick={onStart} className="w-full">
          <Swords className="mr-1.5 size-4" aria-hidden /> Launch battle
        </Button>
      ) : (
        <Button disabled className="w-full">
          <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
          {running
            ? "A game is already running"
            : scanLoading
              ? "Scanning content…"
              : !aisAvailable
                ? "No skirmish AI available"
                : "Preparing…"}
        </Button>
      )}
    </>
  );
}
