import { Button } from "@picoframe/frame";
import { Swords } from "lucide-react";
import { SubstitutedMapNote } from "../../../challenge/SubstitutedMapNote";
import {
  BattleCheckingNotice,
  BattleGutter,
  BattleLaunchGate,
  BattleResultPrompt,
} from "../../../conquest/pages/components/BattleOverlayParts";
import {
  BracketFrame,
  HUD_ACCENT_INK,
} from "../../../conquest/pages/components/hudChrome";
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
  onRestoreMap,
  onClose,
  onCelebrate,
}: {
  run: RogueliteRun;
  /** The run's opaque id, for tagging a freshly-detected replay's provenance. */
  runId?: string;
  node: RunNode;
  onResolved: (next: RogueliteRun) => Promise<void>;
  /** Put this encounter back on the map the challenge named (issue #1834). */
  onRestoreMap: (nodeId: string) => Promise<void>;
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
        {/* Prefers the exact draft last launched (so an outcome save captures
            the fight as fought, with its restrictions and perks), else the
            live briefing snapshot. */}
        <BattleGutter
          onClose={onClose}
          installedGame={!!enc.installedGame}
          getDraft={() => enc.lastSnapshot ?? enc.snapshot()}
          defaultName={`${kindLabel} — ${spec?.mapName ?? "battle"}`}
        />
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
            <Swords className="size-5 text-primary" aria-hidden />
            {kindLabel}
          </h1>
        </header>

        {enc.phase === "briefing" && spec && (
          <div className="flex flex-col gap-3">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row
                label="Battlefield"
                value={spec.mapName}
                note={spec.mapSubstitutedFrom}
                onRestoreNote={() => onRestoreMap(node.id)}
              />
              <Row
                label="Opposition"
                value={`${spec.enemyAiCount} × hostile${spec.handicap > 0 ? ` (+${spec.handicap}%)` : ""}`}
              />
              <Row label="Tech tier" value={`${spec.techTier}`} />
            </dl>
            <p className="text-xs text-muted-foreground">
              Defeat costs health, not the warpath — you retreat and press on.
            </p>
            <BattleLaunchGate
              error={enc.error}
              noEngine={enc.noEngine}
              missing={enc.missing}
              canStart={enc.canStart}
              running={enc.running}
              scanLoading={enc.scanLoading}
              aisAvailable={enc.ais.length > 0}
              onStart={enc.start}
              mapName={spec.mapName}
              mapDownload={spec.mapDownload}
              onRecheck={enc.recheck}
            />
          </div>
        )}

        {enc.phase === "checking" && <BattleCheckingNotice />}

        {enc.phase === "result" && (
          <BattleResultPrompt
            error={enc.error}
            saving={enc.saving}
            onVictory={enc.recordVictory}
            onDefeat={enc.recordDefeat}
          />
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

function Row({
  label,
  value,
  note,
  onRestoreNote,
}: {
  label: string;
  value: string;
  /** The map this encounter should have used, when it is on a stand-in. */
  note?: string;
  /** Move the encounter onto `note`, once this install can offer it. Only the
   * battlefield row has one, so only that row can carry a note. */
  onRestoreNote?: () => Promise<void>;
}) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="min-w-0 text-right">
        <span className="block truncate">{value}</span>
        {onRestoreNote && (
          <SubstitutedMapNote original={note} onRestore={onRestoreNote} />
        )}
      </dd>
    </div>
  );
}
