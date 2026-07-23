import { useSetting } from "@picoframe/frame";
import { Flame, Map as MapIcon, Swords, Trophy } from "lucide-react";
import { useMemo } from "react";
import { OptionSelect } from "../../uberstress/pages/components/OptionSelect";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "../config";
import { allPlayers, profileFor } from "../stats";
import { StatCard, TallyRow } from "./components/StatWidgets";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

/**
 * Personal stats profile ("Player stats" in the Multiplayer nav, moved from
 * Content's "Stats" in #467) — a minimal, offline view over the local
 * replay-stats database (see `stats.rs`). It ingests the library's demos on
 * open, then shows one player's games, win rate, streak, favourite maps and
 * factions. The head-to-head dossier for another player lives at
 * `PlayerDossierPage` (`stats/:name`, #375); per-map/per-faction detail-page
 * records are deferred follow-ups.
 */
export default function StatsPage() {
  const { state } = useContentState();
  const { selected } = useScanTargetSelection();
  const roots = useMemo(() => (state?.roots ?? []).map((r) => r.path), [state]);
  const { records, summary, ingesting, error } = useReplayStats(
    roots,
    selected?.enginePath,
  );

  const players = useMemo(() => allPlayers(records), [records]);
  const [storedName, setStoredName] = useSetting("content.statsPlayer", "");
  // The active player: the stored pick when it still has games, else the
  // most-played name in the library.
  const activeName =
    players.find((p) => p.name === storedName)?.name ?? players[0]?.name ?? "";

  const profile = useMemo(
    () => (activeName ? profileFor(records, activeName) : null),
    [records, activeName],
  );

  const playerOptions = useMemo(
    () =>
      players.map((p) => ({
        value: p.name,
        label: p.name,
        description: `${p.games} game${p.games === 1 ? "" : "s"}`,
      })),
    [players],
  );

  const winRatePct =
    profile?.winRate == null ? null : Math.round(profile.winRate * 100);
  const streak = profile?.currentStreak ?? 0;
  const streakLabel =
    streak === 0
      ? "—"
      : streak > 0
        ? `${streak} win${streak === 1 ? "" : "s"}`
        : `${-streak} loss${streak === -1 ? "" : "es"}`;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Stats</h1>
        <p className="text-sm text-muted-foreground">
          Your record, built from the replays in your content folders. Fully
          offline — no server, no account.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {ingesting && records.length === 0 ? (
        <SkeletonList />
      ) : records.length === 0 ? (
        <EmptyState label="No replays to build stats from yet. Watch a game, or place .sdfz files in your demos folder." />
      ) : !profile ? (
        <EmptyState label="No decodable players found in your replays." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="stats-player"
              className="text-sm text-muted-foreground"
            >
              Player
            </label>
            <div id="stats-player" className="w-56">
              <OptionSelect
                value={activeName}
                onValueChange={setStoredName}
                options={playerOptions}
                size="sm"
              />
            </div>
            {summary && (
              <span className="text-xs text-muted-foreground">
                {summary.total} game{summary.total === 1 ? "" : "s"} indexed
                {summary.failed > 0
                  ? ` · ${summary.failed} could not be read`
                  : ""}
                {ingesting ? " · updating…" : ""}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              icon={<Swords className="size-3.5" />}
              label="Games"
              value={String(profile.games)}
              sub={
                profile.decided < profile.games
                  ? `${profile.decided} with a known result`
                  : undefined
              }
            />
            <StatCard
              icon={<Trophy className="size-3.5" />}
              label="Win rate"
              value={winRatePct == null ? "—" : `${winRatePct}%`}
              sub={
                profile.decided > 0
                  ? `${profile.wins}W · ${profile.losses}L`
                  : "no decided games"
              }
            />
            <StatCard
              icon={<Flame className="size-3.5" />}
              label="Streak"
              value={streakLabel}
            />
            <StatCard
              icon={<Trophy className="size-3.5" />}
              label="Best win run"
              value={String(profile.longestWinStreak)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
                <MapIcon className="size-4 text-muted-foreground" />
                Favourite maps
              </h2>
              {profile.favouriteMaps.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No maps recorded.
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
                Factions
              </h2>
              {profile.factions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No factions recorded.
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
        </>
      )}
    </div>
  );
}
