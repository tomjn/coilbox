import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { useSetting } from "@picoframe/frame";
import { Flame, Map as MapIcon, Swords, Trophy } from "lucide-react";
import { useMemo } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "../config";
import { findSet, resolveSet, useReplaySets } from "../replaySets";
import {
  refightFilenames,
  scriptedModeFilenames,
  useReplayUserState,
} from "../replayUserState";
import { allPlayers, profileFor } from "../stats";
import { AchievementsSection } from "./components/AchievementsSection";
import { AiRecordSection } from "./components/AiRecordSection";
import { PlayerPicker } from "./components/PlayerPicker";
import { StatCard, TallyRow } from "./components/StatWidgets";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

/**
 * Personal stats profile ("Player stats" in the Records nav, moved from
 * Content's "Stats" in #467) — a minimal, offline view over the local
 * replay-stats database (see `stats.rs`). It ingests the library's demos on
 * open, then shows one player's games, win rate, streak, favourite maps and
 * factions. The head-to-head dossier for another player lives at
 * `PlayerDossierPage` (`stats/:name`, #375); per-map/per-faction detail-page
 * records are deferred follow-ups.
 */
export default function StatsPage() {
  const { t } = useLingui();
  const { state } = useContentState();
  const { selected } = useScanTargetSelection();
  const roots = useMemo(() => (state?.roots ?? []).map((r) => r.path), [state]);
  const {
    records: allRecords,
    summary,
    ingesting,
    error,
  } = useReplayStats(roots, selected?.enginePath);
  const { sets } = useReplaySets();
  // Scope the whole page to one set. A saved pick whose set was deleted means
  // every replay again.
  const [storedSet, setStoredSet] = useSetting("content.statsSet", "");
  const activeSet = findSet(sets, storedSet);
  const scoped = useMemo(
    () => (activeSet ? resolveSet(activeSet, allRecords) : null),
    [activeSet, allRecords],
  );
  const records = scoped ? scoped.present : allRecords;
  const { state: replayUserState } = useReplayUserState();
  const refights = useMemo(
    () => refightFilenames(replayUserState),
    [replayUserState],
  );

  const scripted = useMemo(
    () => scriptedModeFilenames(replayUserState),
    [replayUserState],
  );

  const players = useMemo(
    () => allPlayers(records, refights),
    [records, refights],
  );
  const [storedName, setStoredName] = useSetting("content.statsPlayer", "");
  // The active player: the stored pick when it still has games, else the
  // most-played name in the library.
  const activeName =
    players.find((p) => p.name === storedName)?.name ?? players[0]?.name ?? "";

  const profile = useMemo(
    () => (activeName ? profileFor(records, activeName, refights) : null),
    [records, activeName, refights],
  );

  const winRatePct =
    profile?.winRate == null ? null : Math.round(profile.winRate * 100);
  const presentCount = scoped?.present.length ?? 0;
  const memberCount = activeSet?.members.length ?? 0;
  const missingCount = scoped?.missing.length ?? 0;
  const decidedCount = profile?.decided ?? 0;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const failedCount = summary?.failed ?? 0;
  const streak = profile?.currentStreak ?? 0;
  const streakLabel =
    streak === 0
      ? "—"
      : streak > 0
        ? plural(streak, { one: "# win", other: "# wins" })
        : plural(-streak, { one: "# loss", other: "# losses" });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t`Stats`}</h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Your record, built from the replays in your content folders. Fully
            offline — no server, no account.
          </Trans>
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {ingesting && allRecords.length === 0 ? (
        <SkeletonList />
      ) : allRecords.length === 0 ? (
        <EmptyState
          label={t`No replays to build stats from yet. Watch a game, or place .sdfz files in your demos folder.`}
        />
      ) : (
        <>
          {sets.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">
                {t`Replays`}
              </span>
              <OptionSelect
                value={activeSet?.id ?? "all"}
                onValueChange={(v) => setStoredSet(v === "all" ? "" : v)}
                options={[
                  { value: "all", label: t`All replays` },
                  ...sets.map((s) => {
                    const setName = s.name;
                    return { value: s.id, label: t`Set: ${setName}` };
                  }),
                ]}
                ariaLabel={t`Scope to a set`}
                className="w-56"
              />
              {scoped && (
                <span className="text-xs text-muted-foreground">
                  {scoped.missing.length > 0
                    ? t`${presentCount} of ${memberCount} in your library, ${missingCount} missing`
                    : t`${presentCount} of ${memberCount} in your library`}
                </span>
              )}
            </div>
          )}
          {records.length === 0 ? (
            <EmptyState
              label={t`None of the replays in this set are in your library.`}
            />
          ) : !profile ? (
            <EmptyState
              label={t`No decodable players found in your replays.`}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor="stats-player"
                  className="text-sm text-muted-foreground"
                >
                  {t`Player`}
                </label>
                <div className="w-56">
                  <PlayerPicker
                    id="stats-player"
                    value={activeName}
                    onValueChange={setStoredName}
                    players={players}
                  />
                </div>
                {summary && (
                  <span className="text-xs text-muted-foreground">
                    <Plural
                      value={summary.total}
                      one="# game indexed"
                      other="# games indexed"
                    />
                    {summary.failed > 0
                      ? ` · ${t`${failedCount} could not be read`}`
                      : ""}
                    {ingesting ? ` · ${t`updating…`}` : ""}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  icon={<Swords className="size-3.5" />}
                  label={t`Games`}
                  value={String(profile.games)}
                  sub={
                    profile.decided < profile.games
                      ? t`${decidedCount} with a known result`
                      : undefined
                  }
                />
                <StatCard
                  icon={<Trophy className="size-3.5" />}
                  label={t`Win rate`}
                  value={winRatePct == null ? "—" : `${winRatePct}%`}
                  sub={
                    profile.decided > 0
                      ? t`${wins}W · ${losses}L`
                      : t`no decided games`
                  }
                />
                <StatCard
                  icon={<Flame className="size-3.5" />}
                  label={t`Streak`}
                  value={streakLabel}
                />
                <StatCard
                  icon={<Trophy className="size-3.5" />}
                  label={t`Best win run`}
                  value={String(profile.longestWinStreak)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <section className="rounded-lg border border-border/60 bg-card p-4">
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
                    <MapIcon className="size-4 text-muted-foreground" />
                    {t`Favourite maps`}
                  </h2>
                  {profile.favouriteMaps.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t`No maps recorded.`}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {profile.favouriteMaps.slice(0, 8).map((m) => (
                        <TallyRow
                          key={m.key}
                          label={m.key}
                          games={m.games}
                          wins={m.wins}
                        />
                      ))}
                    </ul>
                  )}
                </section>

                <section className="rounded-lg border border-border/60 bg-card p-4">
                  <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
                    <Swords className="size-4 text-muted-foreground" />
                    {t`Factions`}
                  </h2>
                  {profile.factions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t`No factions recorded.`}
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/40">
                      {profile.factions.map((f) => (
                        <TallyRow
                          key={f.key}
                          label={f.key}
                          games={f.games}
                          wins={f.wins}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <AiRecordSection
                records={records}
                playerName={activeName}
                refights={refights}
                scripted={scripted}
              />

              <AchievementsSection
                records={records}
                playerName={activeName}
                refights={refights}
                scripted={scripted}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
