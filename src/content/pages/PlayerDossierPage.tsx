import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useSetting } from "@picoframe/frame";
import {
  ArrowLeft,
  Calendar,
  Code2,
  Flame,
  History,
  Map as MapIcon,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { isProfileHidden } from "../../profile/hidden";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "../config";
import { libraryMetrics } from "../replayMatchFigures";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import {
  allPlayers,
  guessPrimaryPlayer,
  type PlayerReplay,
  profileFor,
  relationTo,
  replaysFor,
} from "../stats";
import { useMetricRegistry, useRatioRegistry } from "../useMetricRegistry";
import { PlayerMatchFigures } from "./components/PlayerMatchFigures";
import { PlayerUnitUsage } from "./components/PlayerUnitUsage";
import { StatCard, TallyRow } from "./components/StatWidgets";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

function playedAt(ms: number): string {
  if (!ms) return t`never`;
  return formatDate(new Date(ms), { dateStyle: "medium" });
}

function outcomeLabel(won: boolean | undefined): string {
  if (won === true) return t`Win`;
  if (won === false) return t`Loss`;
  return t`Unknown`;
}

/**
 * Flags a remix/refight rerun in the replay list (#466) — still listed for a
 * complete history, but visibly marked as not counting toward the stats above.
 */
function ExclusionBadge({
  reason,
}: {
  reason: PlayerReplay["excludedReason"];
}) {
  const { t } = useLingui();
  if (!reason) return null;
  const label = reason === "remix" ? t`Remix` : t`Refight`;
  const title =
    reason === "remix"
      ? t`A coilbox remix — rewritten to run on a local build. Doesn't count toward stats.`
      : t`A refought setup — a rerun of an existing replay. Doesn't count toward stats.`;
  return (
    <Badge
      variant="ghost"
      className="shrink-0 gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary"
      title={title}
    >
      <Code2 className="size-2.5" /> {label}
    </Badge>
  );
}

/**
 * A player dossier (#375): one other player's own record (games, win rate,
 * streak, favourite maps/factions, via `profileFor` — same shape as the
 * personal Player stats page) plus your head-to-head with them (`relationTo`)
 * — games together vs against, and the maps you've shared — plus every
 * replay they appear in (`replaysFor`, #465), most-recent-first, linking to
 * `/play/replays/:name` (#467). Reached from a replay roster's player names.
 * Entirely local, derived from the same stats database as `StatsPage`
 * (#414) — no new data path. Registered at `stats/:name` by the multiplayer
 * plugin (moved from `content/stats/:name` in #467).
 */
export default function PlayerDossierPage() {
  const { t } = useLingui();
  const { name } = useParams();
  const playerName = name ?? "";
  const { state } = useContentState();
  const { selected } = useScanTargetSelection();
  const roots = useMemo(() => (state?.roots ?? []).map((r) => r.path), [state]);
  const { records, ingesting, error } = useReplayStats(
    roots,
    selected?.enginePath,
  );
  const { state: replayUserState } = useReplayUserState();
  const refights = useMemo(
    () => refightFilenames(replayUserState),
    [replayUserState],
  );

  // A distribution that hides match statistics gets none of the figures.
  const statsHidden = isProfileHidden("analytics.matchStats");
  const registry = useMetricRegistry(!statsHidden);
  const ratios = useRatioRegistry(!statsHidden);
  const metrics = useMemo(() => libraryMetrics(registry), [registry]);

  const players = useMemo(
    () => allPlayers(records, refights),
    [records, refights],
  );
  const [storedMe] = useSetting("content.statsPlayer", "");
  const me =
    players.find((p) => p.name === storedMe)?.name ??
    guessPrimaryPlayer(records, refights) ??
    "";

  const profile = useMemo(
    () => (playerName ? profileFor(records, playerName, refights) : null),
    [records, playerName, refights],
  );
  const relation = useMemo(
    () =>
      me && playerName ? relationTo(records, me, playerName, refights) : null,
    [records, me, playerName, refights],
  );
  const replays = useMemo(
    () => (playerName ? replaysFor(records, playerName, refights) : []),
    [records, playerName, refights],
  );

  const decidedCount = profile?.decided ?? 0;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const lastTogether = playedAt(relation?.lastPlayedMs ?? 0);
  const winsTogether = relation?.winsTogether ?? 0;
  const gamesTogether = relation?.gamesTogether ?? 0;
  const winsAgainst = relation?.winsAgainst ?? 0;
  const gamesAgainst = relation?.gamesAgainst ?? 0;
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
          to="/stats"
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> {t`Player stats`}
        </Link>
        <h1 className="text-lg font-semibold">{playerName || t`Player`}</h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Built from the replays in your content folders. Fully offline — no
            server, no account.
          </Trans>
        </p>
      </header>

      {error && <ErrorBanner message={error} />}

      {ingesting && records.length === 0 ? (
        <SkeletonList />
      ) : !profile || profile.games === 0 ? (
        <EmptyState label={t`No replays found for this player.`} />
      ) : (
        <>
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
              label={t`Best win run`}
              value={String(profile.longestWinStreak)}
            />
            <StatCard
              icon={<Calendar className="size-3.5" />}
              label={t`Last seen`}
              value={playedAt(profile.lastPlayedMs)}
              sub={
                relation && relation.gamesShared > 0
                  ? t`with you: ${lastTogether}`
                  : undefined
              }
            />
          </div>

          {me && me !== playerName && relation && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Users className="size-4 text-muted-foreground" />
                <Trans>Head-to-head with you ({me})</Trans>
              </h2>
              {relation.gamesShared === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <Trans>
                    You haven't shared a replay with {playerName} yet.
                  </Trans>
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <StatCard
                    icon={<Trophy className="size-3.5" />}
                    label={t`Together`}
                    value={togetherRate == null ? "—" : `${togetherRate}%`}
                    sub={
                      relation.gamesTogether > 0
                        ? t`${winsTogether}W of ${gamesTogether} on the same team`
                        : t`never on the same team`
                    }
                  />
                  <StatCard
                    icon={<Swords className="size-3.5" />}
                    label={t`Against`}
                    value={againstRate == null ? "—" : `${againstRate}%`}
                    sub={
                      relation.gamesAgainst > 0
                        ? t`${winsAgainst}W of ${gamesAgainst} as opponents`
                        : t`never as opponents`
                    }
                  />
                </div>
              )}
              {relation.gamesAgainst > 0 && (
                <Link
                  to={`/stats/${encodeURIComponent(playerName)}/matchup?me=${encodeURIComponent(me)}`}
                  className="mt-3 inline-flex w-fit items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Swords className="size-3.5" />{" "}
                  <Trans>See the matchup by map, faction and game length</Trans>
                </Link>
              )}
              {relation.commonMaps.length > 0 && (
                <div className="mt-3">
                  <h3 className="mb-1 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <MapIcon className="size-3.5" />
                    {t`Maps you've shared`}
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

          {!statsHidden && (
            <PlayerMatchFigures
              records={records}
              playerName={playerName}
              refightFilenames={refights}
              metrics={metrics}
              ratios={ratios}
            />
          )}

          {!statsHidden && (
            <PlayerUnitUsage
              records={records}
              playerName={playerName}
              refightFilenames={refights}
            />
          )}

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

          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
              <History className="size-4 text-muted-foreground" />
              {t`Replays`}
            </h2>
            {replays.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t`No replays recorded.`}
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {replays.map((r) => (
                  <li key={r.filename}>
                    <Link
                      to={`/play/replays/${encodeURIComponent(r.filename)}`}
                      className="flex items-center justify-between gap-3 py-1.5 text-sm transition-colors hover:text-foreground"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate">
                          {r.mapName}
                          {r.gameType && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {r.gameType}
                            </span>
                          )}
                        </span>
                        <ExclusionBadge reason={r.excludedReason} />
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {playedAt(r.startTimeMs)}
                      </span>
                      <span className="w-16 shrink-0 text-right text-xs font-medium">
                        {outcomeLabel(r.won)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
