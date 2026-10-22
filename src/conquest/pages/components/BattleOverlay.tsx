import { select } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useDrawer } from "@picoframe/frame";
import { ListTree, ShieldAlert, Swords } from "lucide-react";
import { useMemo } from "react";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { useFactionLogos } from "@/factions/logos";
import { SubstitutedMapNote } from "../../../challenge/SubstitutedMapNote";
import { buildEdgeMap, reachableFrom } from "../../../content/buildTree";
import {
  useUnitsyncGameInfo,
  useUnitsyncScan,
  useUnitsyncUnitDataset,
} from "../../../content/config";
import { UnitPicker } from "../../../content/pages/components/UnitPicker";
import { usePreferredTarget } from "../../../play/config";
import { resolveGameByShortname } from "../../../play/installedGames";
import { DIFFICULTY_LABEL } from "../../../play/scenarioDifficulty";
import { factionSides } from "../../galaxy3d/factionShape";
import { conquestGameRef } from "../../gameChoice";
import { drawsAsGalaxy } from "../../mapStyle";
import type { ConquestState, GalaxyDoc, GalaxyNode } from "../../model";
import { difficultyHandicap, difficultyTable } from "../../rules";
import { useConquestBattleRun } from "../../run";
import {
  BattleCheckingNotice,
  BattleGutter,
  BattleLaunchGate,
  BattleResultPrompt,
} from "./BattleOverlayParts";
import { BracketFrame, HUD_ACCENT_INK, HUD_CARD_CLASS } from "./hudChrome";
import { FactionDot } from "./RunSetup";

/**
 * The strategic battle briefing, rendered as an overlay *on the galaxy map*
 * (the map stays live behind it, camera zoomed on the contested system) rather
 * than a separate screen. briefing → launch → checking → result, mirroring the
 * campaign mission flow; the mode is passed in (defend when the node is the
 * active incursion's target, attack otherwise). On a resolved outcome the run
 * hook advances and persists the conquest, then `onClose` returns to the map.
 */
export function BattleOverlay({
  galaxy,
  node,
  state,
  mode,
  onRestoreMap,
  onClose,
}: {
  galaxy: GalaxyDoc;
  node: GalaxyNode;
  state: ConquestState;
  mode: "attack" | "defend";
  /** Put this system back on the map the challenge named for it (issue #1834). */
  onRestoreMap: (nodeId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const run = useConquestBattleRun(galaxy, state, node, mode);
  const drawer = useDrawer();

  const enemyFactionId =
    mode === "defend"
      ? state.incursions.find((i) => i.nodeId === node.id)?.factionId
      : state.owners[node.id];
  const enemyFaction = galaxy.factions.find((f) => f.id === enemyFactionId);
  const enemyCount =
    node.battle.enemyAiCount ?? difficultyTable(node.difficulty);
  const handicap = node.battle.handicap ?? difficultyHandicap(node.difficulty);
  const nodeName = node.name;
  const opponentName = enemyFaction?.name ?? t`garrison`;

  // Faction emblems for the briefing rows (chosen faction + opposition), by side.
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const gameRef = conquestGameRef(galaxy, state);
  const installedGame = resolveGameByShortname(gameRef, scan.data?.games ?? []);
  const factionLogos = useFactionLogos({
    game: installedGame ?? undefined,
    enginePath: target?.enginePath,
    dataDir: target?.dataDir,
    gameArchive: installedGame?.primaryArchive.name,
    sideNames: [state.playerSide, enemyFaction?.side].filter(
      (s): s is string => !!s,
    ),
  });
  const playerLogo = state.playerSide
    ? factionLogos[state.playerSide.toLowerCase()]
    : undefined;
  const enemyLogo = enemyFaction?.side
    ? factionLogos[enemyFaction.side.toLowerCase()]
    : undefined;

  // Read-only tech tree (issue #489). Conquest has no persistent unlock set
  // like warpath's unlockedUnits, so a node's authored disabledUnits
  // restriction stands in as its "opaque id set" (see #377). Light the
  // complement, the units still usable in this fight, against the player's
  // faction tree.
  const dataset = useUnitsyncUnitDataset(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const gameInfo = useUnitsyncGameInfo(
    target?.enginePath,
    target?.dataDir,
    installedGame?.primaryArchive.name,
  );
  const playerStartUnit = state.playerSide
    ? gameInfo.info?.sides.find(
        (s) => s.name.toLowerCase() === state.playerSide?.toLowerCase(),
      )?.startUnit
    : undefined;
  // Scope to the player's own faction tree when it's known, dropping other
  // factions' units so they don't clutter an "Other units" bucket. Otherwise
  // fall back to the whole dataset, which the picker still groups by faction.
  const techUnits = useMemo(() => {
    const units = dataset.dataset?.units ?? [];
    if (!playerStartUnit) return units;
    const reachable = reachableFrom(playerStartUnit, buildEdgeMap(units));
    return units.filter((u) => reachable.has(u.name.toLowerCase()));
  }, [dataset.dataset, playerStartUnit]);
  const availableUnits = useMemo(() => {
    const disabled = new Set(
      (node.battle.disabledUnits ?? []).map((u) => u.toLowerCase()),
    );
    return techUnits
      .map((u) => u.name.toLowerCase())
      .filter((id) => !disabled.has(id));
  }, [techUnits, node.battle.disabledUnits]);
  const openTechTree = installedGame
    ? () =>
        drawer.open({
          title: t`Available units`,
          description: t`Units usable in this fight, lit up against your faction's build tree. Restricted units stay unlit.`,
          width: "40rem",
          content: (
            <UnitPicker
              units={techUnits}
              factions={playerStartUnit ? [{ startUnit: playerStartUnit }] : []}
              selected={availableUnits}
              selectedLabel={t`available`}
              enginePath={target?.enginePath}
              dataDir={target?.dataDir}
              gameArchive={installedGame.primaryArchive.name}
            />
          ),
        })
    : undefined;

  return (
    // A transparent full-bleed layer captures clicks (so the map beneath isn't
    // selectable while briefing) but lets the zoomed star show through. The card
    // sticks to the bottom so it doesn't cover the focused system.
    <div className="absolute inset-0 z-20 flex items-end justify-center p-4 pb-8">
      {/* Clicking the map (anywhere outside the card) dismisses the briefing,
          matching the run map. Nothing has committed yet, so backing out is
          free. */}
      <button
        type="button"
        aria-label={t`Back to map`}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <BracketFrame className="flex w-[30rem] max-w-full flex-col gap-4 p-5 backdrop-blur-sm">
        {/* Prefers the exact draft last launched (so an outcome save captures
            the fight as fought, not the node's now-advanced next matchup),
            else the live briefing snapshot. The tech tree button is
            conquest-only: a read-only lit tree of units still usable in this
            fight (issue #489). */}
        <BattleGutter
          onClose={onClose}
          // A scenario is not a skirmish setup, so there is no preset to save.
          installedGame={!!run.installedGame && !run.scenario}
          getDraft={() => run.lastSnapshot ?? run.snapshot()}
          defaultName={t`${nodeName} vs ${opponentName}`}
          extra={
            openTechTree && (
              <button
                type="button"
                onClick={openTechTree}
                aria-label={t`View available units`}
                title={t`View tech tree`}
                className={`pointer-events-auto absolute right-full top-32 mr-4 flex items-center justify-center p-3.5 text-muted-foreground backdrop-blur-sm transition-colors hover:border-border hover:text-foreground ${HUD_CARD_CLASS}`}
              >
                <ListTree className="size-5" aria-hidden />
              </button>
            )
          }
        />
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold uppercase tracking-wide">
            {mode === "defend" ? (
              <ShieldAlert className="size-5 text-amber-400" aria-hidden />
            ) : (
              <Swords className="size-5 text-primary" aria-hidden />
            )}
            {mode === "defend" ? (
              <Trans>Defend {nodeName}</Trans>
            ) : (
              <Trans>Attack {nodeName}</Trans>
            )}
          </h1>
          {node.blurb && (
            <p className="text-sm text-muted-foreground">{node.blurb}</p>
          )}
        </header>

        {run.phase === "briefing" && (
          <Briefing
            galaxy={galaxy}
            node={node}
            state={state}
            mode={mode}
            enemyName={enemyFaction?.name}
            enemyColor={enemyFaction?.color}
            enemySides={
              enemyFaction ? factionSides(galaxy, enemyFaction.id) : 0
            }
            enemyLogo={enemyLogo}
            playerLogo={playerLogo}
            enemyCount={enemyCount}
            handicap={handicap}
            run={run}
            onRestoreMap={onRestoreMap}
          />
        )}
        {run.phase === "checking" && <BattleCheckingNotice />}
        {run.phase === "result" && (
          <BattleResultPrompt
            error={run.error}
            saving={run.saving}
            onVictory={run.recordVictory}
            onDefeat={run.recordDefeat}
          />
        )}
        {(run.phase === "victory" || run.phase === "defeat") && (
          <Outcome
            phase={run.phase}
            mode={mode}
            node={node}
            resolved={run.resolved}
            autoDetected={run.autoDetected}
            place={drawsAsGalaxy(galaxy) ? "galaxy" : "map"}
            onContinue={onClose}
          />
        )}
      </BracketFrame>
    </div>
  );
}

function Briefing({
  galaxy,
  node,
  state,
  mode,
  enemyName,
  enemyColor,
  enemySides,
  enemyLogo,
  playerLogo,
  enemyCount,
  handicap,
  run,
  onRestoreMap,
}: {
  galaxy: GalaxyDoc;
  node: GalaxyNode;
  state: ConquestState;
  mode: "attack" | "defend";
  enemyName?: string;
  enemyColor?: string;
  enemySides?: number;
  enemyLogo?: FactionLogoSrc;
  playerLogo?: FactionLogoSrc;
  enemyCount: number;
  handicap: number;
  run: ReturnType<typeof useConquestBattleRun>;
  onRestoreMap: (nodeId: string) => Promise<void>;
}) {
  const { t } = useLingui();
  const playerFaction = galaxy.factions.find(
    (f) => f.id === state.playerFactionId,
  );
  const nodeName = node.name;
  const skin = galaxy.theme?.skin ?? "galaxy";
  const heldCapital =
    node.kind === "capital" && state.owners[node.id] === state.playerFactionId;
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-col gap-1.5 text-sm">
        {run.installedGame && (
          <div className="flex justify-between gap-2">
            <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Trans>Game</Trans>
            </dt>
            <dd className="min-w-0 text-right">
              <span className="block truncate">{run.installedGame.name}</span>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Trans>Battlefield</Trans>
          </dt>
          <dd className="min-w-0 text-right">
            <span className="block truncate">{run.mapName}</span>
            {!run.scenario && (
              <SubstitutedMapNote
                original={node.battle.mapSubstitutedFrom}
                onRestore={() => onRestoreMap(node.id)}
              />
            )}
          </dd>
        </div>
        {run.scenario ? (
          // A scenario sets its own forces, so the garrison row would be wrong.
          <>
            <div className="flex justify-between gap-2">
              <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Trans>Scenario</Trans>
              </dt>
              <dd className="min-w-0 text-right">
                <span className="block truncate">{run.scenario.name}</span>
              </dd>
            </div>
            {/* Set by the conquest's threat level and this location, not
                picked here (issue #3593). */}
            {run.scenarioDifficulty && (
              <div className="flex justify-between gap-2">
                <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <Trans>Difficulty</Trans>
                </dt>
                <dd className="min-w-0 text-right">
                  {DIFFICULTY_LABEL[run.scenarioDifficulty]}
                </dd>
              </div>
            )}
          </>
        ) : (
          <div className="flex justify-between gap-2">
            <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Trans>Opposition</Trans>
            </dt>
            <dd className="flex items-center gap-1.5">
              {enemyLogo ? (
                <FactionLogo logo={enemyLogo} sideName={enemyName} size={16} />
              ) : (
                <FactionDot
                  color={enemyColor ?? "#6b7280"}
                  sides={enemySides}
                />
              )}
              {enemyCount} × {enemyName ?? t`garrison`}
              {handicap > 0 ? ` (+${handicap}%)` : ""}
            </dd>
          </div>
        )}
        {playerFaction && (
          <div className="flex justify-between gap-2">
            <dt className="font-display text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <Trans>Fighting for</Trans>
            </dt>
            <dd className="flex items-center gap-1.5">
              {playerLogo ? (
                <FactionLogo
                  logo={playerLogo}
                  sideName={state.playerSide}
                  size={16}
                />
              ) : (
                <FactionDot
                  color={playerFaction.color}
                  sides={factionSides(galaxy, playerFaction.id)}
                />
              )}
              {playerFaction.name}
              {state.playerSide ? ` · ${state.playerSide}` : ""}
            </dd>
          </div>
        )}
        {run.scenario && (
          <p className="text-sm text-muted-foreground">
            <Trans>This location is a scenario, not a skirmish.</Trans>
            {run.scenario.description ? ` ${run.scenario.description}` : ""}{" "}
            <Trans>Win it to take {nodeName}.</Trans>
          </p>
        )}
        {mode === "attack" && (
          <p className="text-xs text-muted-foreground">
            <Trans>
              Defeat costs nothing but the turn — the enemy may move.
            </Trans>
          </p>
        )}
        {mode === "defend" && (
          <p className={`text-xs ${HUD_ACCENT_INK.amber}`}>
            {!heldCapital
              ? select(skin, {
                  galaxy: "Lose this defence and the system falls.",
                  theatre: "Lose this defence and the location falls.",
                  cities: "Lose this defence and the city falls.",
                  territories: "Lose this defence and the province falls.",
                  other: "Lose this defence and the location falls.",
                })
              : drawsAsGalaxy(galaxy)
                ? t`Lose this defence and the system falls — it is your homeworld.`
                : select(skin, {
                    galaxy:
                      "Lose this defence and the system falls — it is your capital.",
                    theatre:
                      "Lose this defence and the location falls — it is your capital.",
                    cities:
                      "Lose this defence and the city falls — it is your capital.",
                    territories:
                      "Lose this defence and the province falls — it is your capital.",
                    other:
                      "Lose this defence and the location falls — it is your capital.",
                  })}
          </p>
        )}
      </dl>

      <BattleLaunchGate
        error={run.error}
        leftOut={run.leftOut}
        noEngine={run.noEngine}
        missing={run.missing}
        scanFailure={run.scanFailure}
        canStart={run.canStart}
        running={run.running}
        scanLoading={run.scanLoading}
        aisAvailable={run.ais.length > 0 || !!run.scenario}
        onStart={run.start}
        mapName={run.mapName}
        mapDownload={run.scenario ? undefined : node.battle.mapDownload}
        game={conquestGameRef(galaxy, state)}
        onRecheck={run.recheck}
        gameOffer={run.gameOffer}
        gameOfferNoun="conquest"
        choosing={run.choosing}
        onChooseGame={(name) => run.answerGameOffer({ pinnedName: name })}
        onDeclineUpgrade={(name) =>
          run.answerGameOffer({ declinedUpdate: name })
        }
      />
    </div>
  );
}

function Outcome({
  phase,
  mode,
  node,
  resolved,
  autoDetected,
  place,
  onContinue,
}: {
  phase: "victory" | "defeat";
  mode: "attack" | "defend";
  node: GalaxyNode;
  resolved: ConquestState | null;
  autoDetected: boolean;
  /** What the strategic map is called: a galaxy for stars, a map otherwise. */
  place: "galaxy" | "map";
  onContinue: () => void;
}) {
  const { t } = useLingui();
  const won = phase === "victory";
  const nodeName = node.name;
  const consequence = won
    ? mode === "attack"
      ? t`${nodeName} is yours.`
      : t`The incursion at ${nodeName} is repelled.`
    : mode === "attack"
      ? t`The assault on ${nodeName} failed. Your territory holds.`
      : t`${nodeName} has fallen.`;
  const hasIncursion = (resolved?.incursions.length ?? 0) > 0;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h2
        className={`font-display text-2xl font-bold uppercase tracking-wide ${won ? "text-emerald-400" : HUD_ACCENT_INK.danger}`}
      >
        {won ? t`Victory` : t`Defeat`}
      </h2>
      <p className="text-sm text-muted-foreground">{consequence}</p>
      {resolved?.status === "won" && (
        <p className="text-sm text-emerald-300">
          {place === "galaxy" ? (
            <Trans>Every enemy capital has fallen — the galaxy is yours.</Trans>
          ) : (
            <Trans>Every enemy capital has fallen — the map is yours.</Trans>
          )}
        </p>
      )}
      {resolved?.status === "lost" && (
        <p className={`text-sm ${HUD_ACCENT_INK.danger}`}>
          <Trans>Your capital is lost.</Trans>
        </p>
      )}
      {resolved?.status === "active" && hasIncursion && (
        <p className="flex items-center gap-1.5 text-sm text-amber-300">
          <ShieldAlert className="size-4" aria-hidden />
          {place === "galaxy" ? (
            <Trans>Enemy incursion detected — check the galaxy map.</Trans>
          ) : (
            <Trans>Enemy incursion detected — check the map.</Trans>
          )}
        </p>
      )}
      {autoDetected && (
        <p className="text-xs text-muted-foreground">
          <Trans>Result detected from the replay.</Trans>
        </p>
      )}
      <Button onClick={onContinue}>
        {place === "galaxy" ? (
          <Trans>Return to the galaxy</Trans>
        ) : (
          <Trans>Return to the map</Trans>
        )}
      </Button>
    </div>
  );
}
