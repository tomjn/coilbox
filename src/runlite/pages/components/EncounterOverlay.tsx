import { Button } from "@picoframe/frame";
import { Download, Loader2, Swords } from "lucide-react";
import { Link } from "react-router";
import { BackToMapButton } from "../../../conquest/pages/components/BackToMapButton";
import {
  BracketFrame,
  HUD_ACCENT_INK,
} from "../../../conquest/pages/components/hudChrome";
import { invalidateMapPreview, invalidateScans } from "../../../content/config";
import { ErrorBanner } from "../../../content/pages/components/states";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { usePreferredTarget } from "../../../play/config";
import { SaveAsPresetButton } from "../../../play/pages/components/SaveAsPresetButton";
import type { RogueliteRun, RunNode } from "../../model";
import { useRunEncounter } from "../../runlite-run";

/**
 * Battle briefing for a battle/elite/boss node, rendered as an overlay on the
 * run map. Mirrors conquest's BattleOverlay flow (briefing → checking → result
 * → victory/defeat) but drives `useRunEncounter`; on a resolved outcome the run
 * is folded through `resolveBattle` and persisted by the hook via `onResolved`.
 */
export function EncounterOverlay({
  run,
  runId,
  node,
  onResolved,
  onClose,
  onCelebrate,
}: {
  run: RogueliteRun;
  /** The run's opaque id, for tagging a freshly-detected replay's provenance. */
  runId?: string;
  node: RunNode;
  onResolved: (next: RogueliteRun) => Promise<void>;
  onClose: () => void;
  /** Called when leaving the map after a victory, to fire the win burst. */
  onCelebrate?: () => void;
}) {
  const enc = useRunEncounter(run, node, onResolved, runId);
  const spec = node.battle;
  const kindLabel =
    node.type === "boss"
      ? "Warlord"
      : node.type === "elite"
        ? "Elite"
        : "Battle";

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center p-4 pb-10">
      <button
        type="button"
        aria-label="Back to map"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <BracketFrame className="flex w-[40rem] max-w-full flex-col gap-4 p-7 backdrop-blur-md">
        {/* Its own box in the gutter to the card's left (not a header link), so
            stepping back to the map is a separate, obvious target. */}
        <BackToMapButton
          onClick={onClose}
          className="absolute right-full top-0 mr-4"
        />
        {/* Its own gutter box beneath the back arrow — save this fight as a
            skirmish preset to replay later. Prefers the exact draft last launched
            (so an outcome save captures the fight as fought, with its restrictions
            and perks), else the live briefing snapshot. */}
        {enc.installedGame && (
          <SaveAsPresetButton
            appearance="gutter"
            getDraft={() => enc.lastSnapshot ?? enc.snapshot()}
            defaultName={`${kindLabel} — ${spec?.mapName ?? "battle"}`}
            className="absolute right-full top-16 mr-4"
          />
        )}
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
            <Swords className="size-5 text-primary" aria-hidden />
            {kindLabel}
          </h1>
        </header>

        {enc.phase === "briefing" && spec && (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Battlefield" value={spec.mapName} />
              <Row
                label="Opposition"
                value={`${spec.enemyAiCount} × hostile${spec.handicap > 0 ? ` (+${spec.handicap}%)` : ""}`}
              />
              <Row label="Tech tier" value={`${spec.techTier}`} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Defeat costs health, not the warpath — you retreat and press on.
            </p>
            {enc.error && <ErrorBanner message={enc.error} />}
            {enc.noEngine ? (
              <p className="text-sm text-muted-foreground">
                Install an engine first (
                <Link
                  className="underline underline-offset-4"
                  to="/settings/engines"
                >
                  Settings → Engines
                </Link>
                ).
              </p>
            ) : enc.missing ? (
              <RequirementGate node={node} enc={enc} />
            ) : enc.canStart ? (
              <Button onClick={enc.start} className="w-full">
                <Swords className="mr-1.5 size-4" aria-hidden /> Launch battle
              </Button>
            ) : (
              <Button disabled className="w-full">
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
                {enc.running
                  ? "A game is already running"
                  : enc.scanLoading
                    ? "Scanning content…"
                    : enc.ais.length === 0
                      ? "No skirmish AI available"
                      : "Preparing…"}
              </Button>
            )}
          </div>
        )}

        {enc.phase === "checking" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Reading the battle report…
          </div>
        )}

        {enc.phase === "result" && (
          <div className="flex flex-col gap-3">
            {enc.error && <ErrorBanner message={enc.error} />}
            <p className="text-sm text-muted-foreground">
              The outcome could not be read from the replay. How did the battle
              end?
            </p>
            <div className="flex gap-2">
              <Button disabled={enc.saving} onClick={enc.recordVictory}>
                Victory
              </Button>
              <Button
                variant="outline"
                disabled={enc.saving}
                onClick={enc.recordDefeat}
              >
                Defeat
              </Button>
            </div>
          </div>
        )}

        {(enc.phase === "victory" || enc.phase === "defeat") && (
          <div className="flex flex-col items-center gap-3 text-center">
            <h2
              className={`font-display text-2xl font-bold uppercase tracking-wide ${enc.phase === "victory" ? "text-emerald-400" : HUD_ACCENT_INK.danger}`}
            >
              {enc.phase === "victory" ? "Victory" : "Defeat"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {enc.phase === "victory"
                ? "Salvage recovered — chart your next course."
                : "You retreat, hull scarred."}
            </p>
            {enc.autoDetected && (
              <p className="text-xs text-muted-foreground">
                Result detected from the replay.
              </p>
            )}
            <Button
              onClick={() => {
                if (enc.phase === "victory") onCelebrate?.();
                onClose();
              }}
            >
              Return to the map
            </Button>
          </div>
        )}
      </BracketFrame>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

/** Install gate: a missing map downloads inline; a missing game links out. */
function RequirementGate({
  node,
  enc,
}: {
  node: RunNode;
  enc: ReturnType<typeof useRunEncounter>;
}) {
  const { target } = usePreferredTarget();
  const missing = enc.missing;
  const mapDl = useQueuedDownload({
    kind: "map",
    label: `Map: ${node.battle?.mapName ?? ""}`,
    args: {
      springName:
        node.battle?.mapDownload?.springName ?? node.battle?.mapName ?? "",
      searchUrl: node.battle?.mapDownload?.searchUrl,
    },
  });
  if (!missing) return null;

  const downloading = mapDl.busy;

  const download = async () => {
    const settled = await mapDl.start();
    if (settled?.status !== "done") return;
    invalidateScans();
    if (target?.enginePath && target?.dataDir && node.battle) {
      invalidateMapPreview(
        target.enginePath,
        target.dataDir,
        node.battle.mapName,
      );
    }
    await enc.recheck();
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
