import { useSetting } from "@picoframe/frame";
import {
  ArrowLeft,
  Calendar,
  Flame,
  Map as MapIcon,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "../config";
import {
  allPlayers,
  guessPrimaryPlayer,
  profileFor,
  relationTo,
} from "../stats";
import { StatCard, TallyRow } from "./components/StatWidgets";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

function playedAt(ms: number): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * A player dossier (#375): one other player's own record (games, win rate,
 * streak, favourite maps/factions, via `profileFor` — same shape as the
 * personal Stats page) plus your head-to-head with them (`relationTo`) — games
 * together vs against, and the maps you've shared. Reached from a replay
 * roster's player names. Entirely local, derived from the same stats database
 * as `StatsPage` (#414) — no new data path.
 */
export default function PlayerDossierPage() {
  const { name } = useParams();
  const playerName = name ? decodeURIComponent(name) : "";
  const { state } = useContentState();
  const { selected } = useScanTargetSelection();
  const roots = useMemo(() => (state?.roots ?? []).map((r) => r.path), [state]);
  const { records, ingesting, error } = useReplayStats(
    roots,
    selected?.enginePath,
  );

  const players = useMemo(() => allPlayers(records), [records]);
  const [storedMe] = useSetting("content.statsPlayer", "");
  const me =
    players.find((p) => p.name === storedMe)?.name ??
    guessPrimaryPlayer(records) ??
    "";

  const profile = useMemo(
    () => (playerName ? profileFor(records, playerName) : null),
    [records, playerName],
  );
  const relation = useMemo(
    () => (me && playerName ? relationTo(records, me, playerName) : null),
    [records, me, playerName],
  );

  const winRatePct =
    profile?.winRate == null ? null : Math.round(profile.winRate * 100);
  const togetherRate =
    relation && relation.gamesTogether > 0
      ? Math.round((relation.winsTogether / relation.gamesTogether) * 100)
      : null;
  const againstRate =
    relation && relation.gamesAgainst > 0
      ? Math.round((relation.winsAgainst / relation.gamesAgainst) * 100)
      : null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <Link
          to="/content/stats"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> Stats
        </Link>
        <h1 className="text-lg font-semibold">{playerName || "Player"}</h1>
        <p className="text-sm text-muted-foreground">
          Built from the replays in your content folders. Fully offline — no
          server, no account.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {ingesting && records.length === 0 ? (
        <SkeletonList />
      ) : !profile || profile.games === 0 ? (
        <EmptyState label="No replays found for this player." />
      ) : (
        <>
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
              label="Best win run"
              value={String(profile.longestWinStreak)}
            />
            <StatCard
              icon={<Calendar className="size-3.5" />}
              label="Last seen"
              value={playedAt(profile.lastPlayedMs)}
              sub={
                relation && relation.gamesShared > 0
                  ? `with you: ${playedAt(relation.lastPlayedMs)}`
                  : undefined
              }
            />
          </div>

          {me && me !== playerName && relation && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Users className="size-4 text-muted-foreground" />
                Head-to-head with you ({me})
              </h2>
              {relation.gamesShared === 0 ? (
                <p className="text-sm text-muted-foreground">
                  You haven't shared a replay with {playerName} yet.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard
                    icon={<Trophy className="size-3.5" />}
                    label="Together"
                    value={togetherRate == null ? "—" : `${togetherRate}%`}
                    sub={
                      relation.gamesTogether > 0
                        ? `${relation.winsTogether}W of ${relation.gamesTogether} on the same team`
                        : "never on the same team"
                    }
                  />
                  <StatCard
                    icon={<Swords className="size-3.5" />}
                    label="Against"
                    value={againstRate == null ? "—" : `${againstRate}%`}
                    sub={
                      relation.gamesAgainst > 0
                        ? `${relation.winsAgainst}W of ${relation.gamesAgainst} as opponents`
                        : "never as opponents"
                    }
                  />
                </div>
              )}
              {relation.commonMaps.length > 0 && (
                <div className="mt-3">
                  <h3 className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <MapIcon className="size-3.5" />
                    Maps you've shared
                  </h3>
                  <ul className="divide-y divide-border/40">
                    {relation.commonMaps.slice(0, 8).map((m) => (
                      <TallyRow
                        key={m.key}
                        label={m.key}
                        games={m.games}
                        wins={m.wins}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

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
