import { useSetting } from "@picoframe/frame";
import {
  ArrowLeft,
  Clock,
  History,
  Map as MapIcon,
  Swords,
} from "lucide-react";
import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { formatDuration } from "@/lib/format";
import {
  useContentState,
  useReplayStats,
  useScanTargetSelection,
} from "../config";
import { gamesLabel, recordCounts } from "../matchupFormat";
import { refightFilenames, useReplayUserState } from "../replayUserState";
import {
  allPlayers,
  guessPrimaryPlayer,
  type MatchupGame,
  type MatchupGroup,
  matchupAgainst,
} from "../stats";
import { SectionHelp } from "./components/SectionHelp";
import { EmptyState, ErrorBanner, SkeletonList } from "./components/states";

function playedAt(ms: number): string {
  if (!ms) return "never";
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function outcomeLabel(won: boolean | undefined): string {
  if (won === true) return "Win";
  if (won === false) return "Loss";
  return "Unknown";
}

/** One square per game, oldest first: a win, a loss, or no recorded result. */
function GameStrip({ group }: { group: MatchupGroup }) {
  const oldestFirst = [...group.matches].reverse();
  return (
    <span
      role="img"
      aria-label={oldestFirst.map((g) => outcomeLabel(g.won)).join(", ")}
      className="flex shrink-0 flex-wrap gap-0.5"
    >
      {oldestFirst.map((g) => (
        <span
          key={g.record.filename}
          title={outcomeLabel(g.won)}
          className={
            g.won === true
              ? "size-2.5 rounded-sm bg-primary/70"
              : g.won === false
                ? "size-2.5 rounded-sm bg-destructive/70"
                : "size-2.5 rounded-sm border border-border"
          }
        />
      ))}
    </span>
  );
}

function GroupSection({
  icon,
  title,
  groups,
}: {
  icon: React.ReactNode;
  title: string;
  groups: MatchupGroup[];
}) {
  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded.</p>
      ) : (
        <ul className="divide-y divide-border/40">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm" title={g.key}>
                  {g.key}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {gamesLabel(g.games)} · {recordCounts(g)}
                </span>
              </span>
              <GameStrip group={g} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchRow({ game }: { game: MatchupGame }) {
  const r = game.record;
  return (
    <li>
      <Link
        to={`/play/replays/${encodeURIComponent(r.filename)}`}
        className="flex items-center justify-between gap-3 py-1.5 text-sm transition-colors hover:text-foreground"
      >
        <span className="min-w-0 flex-1 truncate">
          {r.mapName}
          <span className="text-muted-foreground">
            {" "}
            · {game.myFaction} vs {game.theirFaction}
          </span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatDuration(r.durationSec)}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {playedAt(r.startTimeMs)}
        </span>
        <span className="w-16 shrink-0 text-right text-xs font-medium">
          {outcomeLabel(game.won)}
        </span>
      </Link>
    </li>
  );
}

/**
 * Your matchup against one other player (#1168): the games where you were on
 * opposing teams, grouped by map, faction pairing and game length, with every
 * record shown as a count and never a percentage. Opened from the head to head
 * on the player dossier and from the multiplayer user popover. `?me=` names
 * the library player, and without it the page picks the same player the
 * dossier does.
 */
export default function MatchupPage() {
  const { name } = useParams();
  const other = name ?? "";
  const [searchParams] = useSearchParams();
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
  const players = useMemo(
    () => allPlayers(records, refights),
    [records, refights],
  );
  const [storedMe] = useSetting("content.statsPlayer", "");
  const me =
    searchParams.get("me") ||
    (players.find((p) => p.name === storedMe)?.name ??
      guessPrimaryPlayer(records, refights) ??
      "");

  const matchup = useMemo(
    () => (me && other ? matchupAgainst(records, me, other, refights) : null),
    [records, me, other, refights],
  );

  const left = matchup ? matchup.gamesTogether + matchup.gamesSideUnknown : 0;

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <Link
          to={`/stats/${encodeURIComponent(other)}`}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <ArrowLeft className="size-3.5" /> {other || "Player"}
        </Link>
        <div className="flex items-center gap-1">
          <h1 className="text-lg font-semibold">
            {me && other ? `${me} vs ${other}` : "Matchup"}
          </h1>
          <SectionHelp section="the matchup">
            <p>
              A matchup is the games where you were on opposing teams, from the
              replays in your content folders.
            </p>
            {matchup && left > 0 && (
              <p>
                {matchup.gamesTogether > 0 &&
                  `${gamesLabel(matchup.gamesTogether)} on the same team not counted. `}
                {matchup.gamesSideUnknown > 0 &&
                  `${gamesLabel(matchup.gamesSideUnknown)} with an unknown team not counted.`}
              </p>
            )}
            <p>
              Each square is one game, oldest first. Filled is a win, red is a
              loss, an outline is no recorded result.
            </p>
          </SectionHelp>
        </div>
      </header>

      {error && <ErrorBanner message={error} />}

      {ingesting && records.length === 0 ? (
        <SkeletonList />
      ) : !me ? (
        <EmptyState label="No player to compare against yet." />
      ) : me === other ? (
        <EmptyState label="Pick another player to see a matchup." />
      ) : !matchup || matchup.overall.games === 0 ? (
        <EmptyState
          label={
            left > 0
              ? `You and ${other} have not played on opposing teams. ${gamesLabel(left)} on the same team or with an unknown team are not counted.`
              : `You have not shared a replay with ${other}.`
          }
        />
      ) : (
        <>
          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
              <Swords className="size-4 text-muted-foreground" />
              Overall
            </h2>
            <p className="text-sm">
              {gamesLabel(matchup.overall.games)} against {other}:{" "}
              {recordCounts(matchup.overall)}.
            </p>
          </section>

          <GroupSection
            icon={<MapIcon className="size-4 text-muted-foreground" />}
            title="By map"
            groups={matchup.byMap}
          />
          <GroupSection
            icon={<Swords className="size-4 text-muted-foreground" />}
            title="By faction pairing (yours vs theirs)"
            groups={matchup.byFactions}
          />
          <GroupSection
            icon={<Clock className="size-4 text-muted-foreground" />}
            title="By game length"
            groups={matchup.byLength}
          />

          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
              <History className="size-4 text-muted-foreground" />
              Games
            </h2>
            <ul className="divide-y divide-border/40">
              {matchup.matches.map((g) => (
                <MatchRow key={g.record.filename} game={g} />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
