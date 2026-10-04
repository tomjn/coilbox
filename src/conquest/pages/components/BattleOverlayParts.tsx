import { Button } from "@picoframe/frame";
import { Download, Loader2, Swords } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { MapDownloadHint } from "../../../campaign/model";
import { invalidateMapPreview, invalidateScans } from "../../../content/config";
import {
  ErrorBanner,
  ScanFailed,
} from "../../../content/pages/components/states";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { usePreferredTarget } from "../../../play/config";
import type { SkirmishDraft } from "../../../play/drafts";
import { resolveGameDownload } from "../../../play/gameOffer";
import type { GameOffer } from "../../../play/installedGames";
import { DownloadGameButton } from "../../../play/pages/components/DownloadGameButton";
import { GameChoiceOffer } from "../../../play/pages/components/GameChoiceOffer";
import { SaveAsPresetButton } from "../../../play/pages/components/SaveAsPresetButton";
import type { BattleRequirement } from "../../../play/useBattleRun";
import { useGameCatalog } from "../../../play/useGameCatalog";
import type { GameRef } from "../../model";
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

/** Install gate: a missing map downloads inline. A missing game downloads
 * through the launch check when `game` is given and a download can be named for
 * it (issue #3368), and otherwise links to the Downloads page. */
function MissingContentGate({
  missing,
  mapName,
  mapDownload,
  game,
  onRecheck,
}: {
  missing: BattleRequirement;
  mapName: string;
  mapDownload?: MapDownloadHint;
  game?: GameRef;
  onRecheck: () => void | Promise<void>;
}) {
  const { target } = usePreferredTarget();
  const gameCatalog = useGameCatalog();
  const gameDownload = game ? resolveGameDownload(game, gameCatalog) : null;
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
        {missing.kind === "map"
          ? "Map"
          : missing.kind === "dependency"
            ? "Archive"
            : "Game"}{" "}
        not installed: <span className="text-foreground">{missing.name}</span>
      </p>
      {missing.kind === "dependency" && missing.gameName && (
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{missing.gameName}</span> depends on
          it.
        </p>
      )}
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
      ) : game && gameDownload && missing.kind === "game" ? (
        <DownloadGameButton
          game={game}
          download={gameDownload}
          onReady={onRecheck}
          className="w-full"
        />
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
  scanFailure = null,
  canStart,
  running,
  scanLoading,
  aisAvailable,
  onStart,
  mapName,
  mapDownload,
  game,
  onRecheck,
  gameOffer = null,
  gameOfferNoun,
  gameOfferNote,
  choosing = false,
  onChooseGame,
  onDeclineUpgrade,
  hold,
}: {
  error?: string | null;
  noEngine: boolean;
  missing: BattleRequirement | null;
  /** Why the content scan could not say what is installed (its unitsync `Init`
   *  failed), so there is no missing game or map to name (issue #3398). */
  scanFailure?: string | null;
  canStart: boolean;
  running: boolean;
  scanLoading: boolean;
  aisAvailable: boolean;
  onStart: () => void;
  mapName: string;
  mapDownload?: MapDownloadHint;
  /** The game the battle is for. Given, a missing game downloads in place. */
  game?: GameRef;
  onRecheck: () => void | Promise<void>;
  /** A question about which installed game the run uses, answered before the
   *  battle can launch (issue #3465). */
  gameOffer?: GameOffer | null;
  gameOfferNoun?: "warpath" | "conquest";
  gameOfferNote?: ReactNode;
  choosing?: boolean;
  onChooseGame?: (name: string) => void;
  onDeclineUpgrade?: (declinedName: string) => void;
  /** Something the battle waits on that is not the content scan, such as a
   *  warpath's unit data (issue #3473). Shown on the disabled launch button. */
  hold?: { label: string; busy: boolean };
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
      ) : scanFailure ? (
        <ScanFailed noun="games or maps" reason={scanFailure} />
      ) : missing ? (
        <MissingContentGate
          missing={missing}
          mapName={mapName}
          mapDownload={mapDownload}
          game={game}
          onRecheck={onRecheck}
        />
      ) : gameOffer && onChooseGame && onDeclineUpgrade && gameOfferNoun ? (
        <GameChoiceOffer
          offer={gameOffer}
          noun={gameOfferNoun}
          busy={choosing}
          note={gameOfferNote}
          onChoose={onChooseGame}
          onDecline={onDeclineUpgrade}
        />
      ) : canStart ? (
        <Button onClick={onStart} className="w-full">
          <Swords className="mr-1.5 size-4" aria-hidden /> Launch battle
        </Button>
      ) : (
        <Button disabled className="w-full">
          {(hold?.busy ?? true) && (
            <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
          )}
          {running
            ? "A game is already running"
            : scanLoading
              ? "Scanning content…"
              : !aisAvailable
                ? "No skirmish AI available"
                : (hold?.label ?? "Preparing…")}
        </Button>
      )}
    </>
  );
}
