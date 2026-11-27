import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { formatDuration, formatList, formatNumber } from "@/lib/format";
import type { DemoInfo } from "../../bindings";
import { formatTotal, seatsByTeam } from "../../matchStats";
import { analysisRunHidden, useStoredAnalyses } from "../../replayAnalysis";
import type { LogEvent } from "../../replayAnalysisEvents";
import {
  AWARD_KINDS,
  type Award,
  type AwardId,
  matchAwards,
  pickAwards,
} from "../../replayAwards";
import { type EventState, eventState } from "../../replayEventLayers";
import { readReplayEvents } from "../../replayEventRead";
import { useReplayUnits } from "../../useReplayUnits";
import { SectionHelp } from "./SectionHelp";
import { StoredListNote } from "./UnitListNotes";

/**
 * The match awards on the Summary tab (#5492). Nothing is shown for a replay
 * with no analysis. The map card and the analysis section already say how to
 * make one.
 */

const TITLE: Record<AwardId, MessageDescriptor> = {
  economyKilled: msg`Most enemy economy destroyed`,
  fightingKilled: msg`Most enemy fighting units destroyed`,
  efficiency: msg`Most efficient`,
  produced: msg`Most metal produced`,
  damageTaken: msg`Most damage taken`,
  noKill: msg`Longest time without a kill`,
  everything: msg`Won every award`,
};

export function ReplayAwards({ info }: { info: DemoInfo }) {
  const analyses = useStoredAnalyses();
  const stored =
    info.remixed || !info.gameId ? undefined : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  if (state.kind !== "ready") return null;
  return <AnalysedAwardsSection info={info} state={state} />;
}

type Read =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "done"; events: LogEvent[] };

function AnalysedAwardsSection({
  info,
  state,
}: {
  info: DemoInfo;
  state: Extract<EventState, { kind: "ready" }>;
}) {
  const { t } = useLingui();
  const [read, setRead] = useState<Read>({ status: "loading" });
  const units = useReplayUnits(info, true, "events");

  const { gameId, analysedAtMs: atMs } = state;
  useEffect(() => {
    let stale = false;
    setRead({ status: "loading" });
    readReplayEvents(gameId, atMs, AWARD_KINDS).then(
      (events) => {
        if (!stale) setRead({ status: "done", events });
      },
      () => {
        if (!stale) setRead({ status: "failed" });
      },
    );
    return () => {
      stale = true;
    };
  }, [gameId, atMs]);

  const seats = useMemo(() => seatsByTeam(info), [info]);
  const analysed = useMemo(() => {
    if (read.status !== "done") return null;
    const allyTeams = new Map<number, number>();
    for (const seat of [
      ...info.players.filter((p) => !p.spectator),
      ...info.ais,
    ])
      if (seat.team !== undefined && seat.allyTeam !== undefined)
        allyTeams.set(seat.team, seat.allyTeam);
    return matchAwards(read.events, units.units, allyTeams);
  }, [read, units.units, info]);

  if (read.status === "failed")
    return (
      <Frame>
        <p className="text-xs text-destructive">
          <Trans>
            The events could not be read from this replay's analysis.
          </Trans>
        </p>
      </Frame>
    );
  if (!analysed)
    return (
      <Frame>
        <Note>{t`Reading events…`}</Note>
      </Frame>
    );

  // BAR's recorded awards go in here when something reads them (#5490).
  const shown = pickAwards({ recorded: null, analysed: analysed.awards });
  if (!shown) return null;

  const loadingUnits =
    !units.units && (!units.source || units.status === "loading");
  const recordedGame = units.recorded;
  const installedGame =
    units.source?.kind === "differentBuild" ? units.source.game.name : "";
  const game = units.recorded || t`This replay's game`;

  return (
    <Frame help={<Method />}>
      {loadingUnits ? (
        <Note>{t`Reading unit definitions…`}</Note>
      ) : units.source?.kind === "notInstalled" ? (
        <Note>{t`${game} is not installed, so nothing says what a unit costs. The awards that need a cost are left out.`}</Note>
      ) : !units.units ? (
        <Note>{t`The units of this replay's game could not be read, so the awards that need a cost are left out.`}</Note>
      ) : (
        <>
          <StoredListNote source={units.source} subject={t`Costs and kinds`} />
          {units.source?.kind === "differentBuild" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              <Trans>
                This replay was played on {recordedGame}, which is not
                installed. Costs and kinds come from {installedGame}, a
                different build, and may be wrong.
              </Trans>
            </p>
          )}
          {analysed.unpriced > 0 && (
            <Note>
              <Plural
                value={analysed.unpriced}
                one="# destroyed unit has no metal cost in this unit list and counts nothing."
                other="# destroyed units have no metal cost in this unit list and count nothing."
              />
            </Note>
          )}
        </>
      )}
      <dl className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-3 text-sm">
        {shown.awards.map((award) => (
          <AwardRow key={award.id} award={award} seats={seats} />
        ))}
      </dl>
    </Frame>
  );
}

function Frame({ help, children }: { help?: ReactNode; children: ReactNode }) {
  const { t } = useLingui();
  return (
    <section aria-label={t`Awards`} className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">{t`Awards`}</h2>
        {help && (
          <SectionHelp section={t`awards`} source="log">
            {help}
          </SectionHelp>
        )}
      </div>
      {children}
    </section>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

function AwardRow({
  award,
  seats,
}: {
  award: Award;
  seats: ReturnType<typeof seatsByTeam>;
}) {
  const { t, i18n } = useLingui();
  const nameOf = (team: number) => {
    const held = seats.get(team);
    return held
      ? formatList(
          held.map((s) => s.name),
          "conjunction",
        )
      : t`Team ${team}`;
  };
  const scoreOf = (score: number) => {
    switch (award.id) {
      case "efficiency": {
        const ratio = formatNumber(score, { maximumFractionDigits: 2 });
        return t`${ratio} metal destroyed for each metal spent`;
      }
      case "damageTaken": {
        const damage = formatTotal(score);
        return t`${damage} damage`;
      }
      case "noKill":
        return formatDuration(Math.round(score));
      default: {
        const metal = formatTotal(score);
        return t`${metal} metal`;
      }
    }
  };
  return (
    <div data-award={award.id} className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">
        {i18n._(TITLE[award.id])}
      </dt>
      {award.places.map(({ place, team, score }) => (
        <dd key={team} className="flex items-baseline gap-2">
          <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
            {formatNumber(place)}
          </span>
          <span className="min-w-0 grow break-words">{nameOf(team)}</span>
          {score !== null && (
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {scoreOf(score)}
            </span>
          )}
        </dd>
      ))}
    </div>
  );
}

/** How each award is worked out, for the section's help. */
function Method() {
  return (
    <>
      <p>
        <Trans>
          Economy destroyed counts the metal cost of enemy economy buildings.
          Fighting units destroyed counts the metal cost of enemy units and
          turrets with a weapon, apart from those that build. Efficiency is the
          metal cost of every enemy unit destroyed, divided by the metal spent.
          A unit still being built counts nothing.
        </Trans>
      </p>
      <p>
        <Trans>
          Metal produced and damage taken are the engine's totals at the end of
          the game. The time without a kill runs from the start of the game, and
          stops when a team has no units left.
        </Trans>
      </p>
      <p>
        <Trans>
          Teams with the same score share a place, and a score of nothing wins
          nothing. A team wins every award by being alone in first place in all
          of the others. Energy is not counted, because metal and energy are
          never added together.
        </Trans>
      </p>
    </>
  );
}
