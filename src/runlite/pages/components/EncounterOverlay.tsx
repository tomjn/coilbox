import { t as coreT } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Swords } from "lucide-react";
import { SubstitutedMapNote } from "../../../challenge/SubstitutedMapNote";
import type { NodeScenario } from "../../../conquest/model";
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
import { useUnitsyncUnitDataset } from "../../../content/config";
import { usePreferredTarget } from "../../../play/config";
import { DIFFICULTY_LABEL } from "../../../play/scenarioDifficulty";
import { unitsMissingFrom } from "../../gameChoice";
import type { RogueliteRun, RunNode } from "../../model";
import { useRunEncounter } from "../../runlite-run";
import { limitHold } from "../../unitLimit";
import { UnitLimitNote } from "./UnitLimitNote";

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
  scenario,
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
  /** The scenario this node plays, read from the run's hand-made map. */
  scenario?: NodeScenario;
}) {
  const { t } = useLingui();
  const enc = useRunEncounter(run, node, onResolved, runId, scenario);
  // The node names a scenario and the map could not give it, so the node's
  // own encounter is fought and the briefing says why.
  const scenarioLost = !!node.scenario && !scenario;
  const { target } = usePreferredTarget();
  // Before offering a move to another version, check that the units the run
  // has unlocked exist there (issue #3465).
  const offered =
    enc.gameOffer && enc.gameOffer.kind !== "choose"
      ? enc.gameOffer.newer
      : undefined;
  const { dataset: offeredDataset } = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    offered?.primaryArchive.name,
  );
  const offeredName = offered?.name;
  const offerNote = offered
    ? offeredDataset
      ? moveNote(
          offered.name,
          unitsMissingFrom(
            run,
            offeredDataset.units.map((u) => u.name),
          ),
        )
      : t`Checking that your units exist in ${offeredName}…`
    : undefined;
  const hold = limitHold(enc.limit);
  const spec = node.battle;
  const kindLabel =
    node.type === "boss"
      ? t`Warlord`
      : node.type === "elite"
        ? t`Elite`
        : t`Battle`;
  const mapNameForPreset = spec?.mapName ?? t`battle`;
  const hostileCount = spec?.enemyAiCount;
  const hostileHandicap = spec?.handicap;

  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center p-4 pb-10">
      <button
        type="button"
        aria-label={t`Back to map`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <BracketFrame className="flex w-[40rem] max-w-full flex-col gap-4 p-7 backdrop-blur-md">
        {/* Prefers the exact draft last launched (so an outcome save captures
            the fight as fought, with its restrictions and perks), else the
            live briefing snapshot. */}
        <BattleGutter
          onClose={onClose}
          // A scenario is not a skirmish setup, so there is no preset to save.
          installedGame={!!enc.installedGame && !scenario}
          getDraft={() => enc.lastSnapshot ?? enc.snapshot()}
          defaultName={`${kindLabel} — ${mapNameForPreset}`}
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
              {enc.installedGame && (
                <Row label={t`Game`} value={enc.installedGame.name} />
              )}
              {scenario ? (
                // A scenario sets its own map and forces, and the run's unit
                // limit is not applied to it.
                <>
                  <Row
                    label={t`Battlefield`}
                    value={scenario.doc.setup.mapName}
                  />
                  <Row label={t`Scenario`} value={scenario.doc.name} />
                  {/* Set by the run's difficulty and how far along it this
                      location is, not picked here (issue #3593). */}
                  {enc.scenarioDifficulty && (
                    <Row
                      label={t`Difficulty`}
                      value={DIFFICULTY_LABEL[enc.scenarioDifficulty]}
                    />
                  )}
                </>
              ) : (
                <>
                  <Row
                    label={t`Battlefield`}
                    value={spec.mapName}
                    note={spec.mapSubstitutedFrom}
                    onRestoreNote={() => onRestoreMap(node.id)}
                  />
                  <Row
                    label={t`Opposition`}
                    value={
                      spec.handicap > 0
                        ? t`${hostileCount} × hostile (+${hostileHandicap}%)`
                        : t`${hostileCount} × hostile`
                    }
                  />
                  <Row label={t`Tech tier`} value={`${spec.techTier}`} />
                </>
              )}
            </dl>
            {scenario ? (
              <p className="text-sm text-muted-foreground">
                <Trans>This location is a scenario, not a skirmish.</Trans>
                {scenario.doc.description ? ` ${scenario.doc.description}` : ""}{" "}
                <Trans>Win it to clear the location.</Trans>
              </p>
            ) : (
              <UnitLimitNote
                limit={enc.limit}
                startUnit={run.startUnit}
                gameName={
                  enc.installedGame?.name ??
                  run.settings.game.pinnedName ??
                  run.settings.game.shortname
                }
              />
            )}
            {scenarioLost && (
              <p className={`text-xs ${HUD_ACCENT_INK.amber}`}>
                <Trans>
                  This location plays a scenario from the hand-made map, and the
                  scenario could not be read. It is a skirmish on the same
                  battlefield until the map is back as it was.
                </Trans>
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              <Trans>
                Defeat costs health, not the warpath — you retreat and press on.
              </Trans>
            </p>
            <BattleLaunchGate
              error={enc.error ?? (scenario ? undefined : hold?.error)}
              leftOut={enc.leftOut}
              hold={scenario ? undefined : (hold ?? undefined)}
              noEngine={enc.noEngine}
              missing={enc.missing}
              scanFailure={enc.scanFailure}
              canStart={enc.canStart}
              running={enc.running}
              scanLoading={enc.scanLoading}
              aisAvailable={enc.ais.length > 0 || !!scenario}
              onStart={enc.start}
              mapName={scenario?.doc.setup.mapName ?? spec.mapName}
              mapDownload={scenario ? undefined : spec.mapDownload}
              game={run.settings.game}
              onRecheck={enc.recheck}
              gameOffer={enc.gameOffer}
              gameOfferNoun="warpath"
              gameOfferNote={offerNote}
              choosing={enc.choosing}
              onChooseGame={(name) => enc.answerGameOffer({ pinnedName: name })}
              onDeclineUpgrade={(name) =>
                enc.answerGameOffer({ declinedUpdate: name })
              }
            />
            {enc.limit.kind === "failed" && !scenario && (
              <Button
                variant="outline"
                onClick={enc.reloadUnitData}
                className="w-full"
              >
                <Trans>Try reading the unit data again</Trans>
              </Button>
            )}
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
              {enc.phase === "victory" ? t`Victory` : t`Defeat`}
            </h2>
            <p className="text-sm text-muted-foreground">
              {enc.phase === "victory"
                ? t`Salvage recovered — chart your next course.`
                : t`You retreat, hull scarred.`}
            </p>
            {enc.autoDetected && (
              <p className="text-xs text-muted-foreground">
                <Trans>Result detected from the replay.</Trans>
              </p>
            )}
            <Button
              onClick={() => {
                if (enc.phase === "victory") onCelebrate?.();
                onClose();
              }}
            >
              <Trans>Return to the map</Trans>
            </Button>
          </div>
        )}
      </BracketFrame>
    </div>
  );
}

/** What to tell the player about moving the run's units to another game. */
function moveNote(gameName: string, missing: string[]): string {
  if (missing.length === 0) {
    return coreT`Your start unit and unlocked units are all in ${gameName}.`;
  }
  const shown = missing.slice(0, 8).join(", ");
  if (missing.length > 8) {
    const extra = missing.length - 8;
    return coreT`${gameName} does not have these units from your run: ${shown} and ${extra} more. They will not be available if you move.`;
  }
  return coreT`${gameName} does not have these units from your run: ${shown}. They will not be available if you move.`;
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
