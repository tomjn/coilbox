import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { buttonVariants, cn } from "@picoframe/frame";
import { Award, Bot, Milestone, Orbit, Rocket, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { GameIcon } from "@/components/GameIcon";
import { Badge } from "@/components/ui/badge";
import { MAX_THREAT_LEVEL } from "../../conquest/threat";
import type { AchievementResult } from "../../content/achievements";
import { AchievementRow } from "../../content/pages/components/AchievementsSection";
import { StatCard } from "../../content/pages/components/StatWidgets";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { getLocale } from "../../i18n";
import { isProfileHidden } from "../../profile/hidden";
import {
  type AiSummary,
  achievementDigest,
  type CampaignRow,
  type CareerGame,
  type ConquestSummary,
  careerTotals,
  type WarpathSummary,
} from "../career";
import {
  type CareerData,
  type SourceId,
  type SourceStatus,
  useCareer,
} from "../useCareer";

const SOURCE_ORDER: SourceId[] = [
  "campaigns",
  "conquest",
  "warpath",
  "ai",
  "games",
];

/** The items in the app language's list style, e.g. `A, B, C` under `en`. */
const joinList = (parts: string[]) =>
  new Intl.ListFormat(getLocale(), { type: "unit", style: "long" }).format(
    parts,
  );

function SectionHeading({
  icon,
  children,
  link,
}: {
  icon: ReactNode;
  children: ReactNode;
  link?: { to: string; label: string };
}) {
  return (
    <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
      <span className="text-muted-foreground">{icon}</span>
      {children}
      {link && (
        <Link
          to={link.to}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "ml-auto",
          )}
        >
          {link.label}
        </Link>
      )}
    </h3>
  );
}

function CampaignRowStatus({ row }: { row: CampaignRow }) {
  const { t } = useLingui();
  const missions = row.missions;
  const completed = row.completed;
  const nextMission = row.nextMission;
  const progress = row.finished
    ? plural(missions, {
        one: "Finished, # mission",
        other: "Finished, # missions",
      })
    : plural(missions, {
        one: `${completed} of # mission`,
        other: `${completed} of # missions`,
      });
  return (
    <>
      {progress}
      {nextMission ? ` · ${t`next: ${nextMission}`}` : ""}
    </>
  );
}

function CampaignsSection({ rows }: { rows: CampaignRow[] }) {
  return (
    <section className="flex flex-col">
      <SectionHeading icon={<Milestone className="size-4" />}>
        <Trans>Campaigns</Trans>
      </SectionHeading>
      <ul className="divide-y divide-border/40">
        {rows.map((row) => (
          <li
            key={row.id}
            className="relative flex items-baseline gap-3 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50"
          >
            {/* The link's ::after covers the row, so the whole row is the
                target and the link's name stays the campaign title. */}
            <Link
              to={`/campaign/${encodeURIComponent(row.id)}`}
              className="min-w-0 flex-1 truncate font-medium after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary"
            >
              {row.title}
            </Link>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              <CampaignRowStatus row={row} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConquestSection({ conquest }: { conquest: ConquestSummary }) {
  const { t } = useLingui();
  const { won, finished, threatLevel, inProgress } = conquest;
  const maxThreat = MAX_THREAT_LEVEL;
  const parts = [
    t`${won} won of ${finished} finished`,
    t`highest threat level unlocked: ${threatLevel} of ${maxThreat}`,
  ];
  if (inProgress > 0) {
    parts.push(t`${inProgress} in progress`);
  }
  return (
    <section>
      <SectionHeading
        icon={<Orbit className="size-4" />}
        link={{ to: "/conquest", label: t`Open Conquest` }}
      >
        <Trans>Conquest</Trans>
      </SectionHeading>
      <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>
    </section>
  );
}

function AiSection({ ai, showLink }: { ai: AiSummary; showLink: boolean }) {
  const { t } = useLingui();
  const { wins, losses, undecided } = ai;
  const games = ai.games;
  const result = [t`${wins}W`, t`${losses}L`];
  if (undecided > 0) result.push(t`${undecided} undecided`);
  const gamesText = plural(games, { one: "# game", other: "# games" });
  const topGames = ai.topAi?.games ?? 0;
  const topName = ai.topAi?.bonus
    ? `${ai.topAi.ai} (${ai.topAi.bonus})`
    : (ai.topAi?.ai ?? "");
  const mostPlayed = plural(topGames, {
    one: `most played: ${topName}, # game`,
    other: `most played: ${topName}, # games`,
  });
  return (
    <section>
      <SectionHeading
        icon={<Bot className="size-4" />}
        link={
          showLink ? { to: "/stats", label: t`Open Player stats` } : undefined
        }
      >
        <Trans>Against AI</Trans>
      </SectionHeading>
      <p className="text-sm text-muted-foreground">
        {gamesText} · {result.join(" · ")}
        {ai.topAi ? ` · ${mostPlayed}` : ""}
      </p>
    </section>
  );
}

/** What a Warpath summary says: the runs, then what the game offers. */
function WarpathLines({ warpath }: { warpath: WarpathSummary }) {
  const { t } = useLingui();
  const { runs, wins, deepest, ascensionTier, maxAscension } = warpath;
  const loadouts =
    warpath.loadouts.length > 0 ? joinList(warpath.loadouts) : t`none yet`;
  const eventPools =
    warpath.eventPools.length > 0 ? joinList(warpath.eventPools) : t`none yet`;
  return (
    <>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Rocket className="size-4" />
        {plural(runs, { one: "# run", other: "# runs" })} ·{" "}
        {plural(wins, { one: "# win", other: "# wins" })} ·{" "}
        {t`deepest column ${deepest}`} ·{" "}
        {t`ascension tier ${ascensionTier} of ${maxAscension}`}
      </p>
      <p className="text-sm text-muted-foreground">
        {t`Unlocked loadouts: ${loadouts} · event pools: ${eventPools}`}
      </p>
    </>
  );
}

function WarpathSection({ warpath }: { warpath: WarpathSummary }) {
  const { t } = useLingui();
  return (
    <section>
      <SectionHeading
        icon={<Rocket className="size-4" />}
        link={{ to: "/warpath", label: t`Open Warpath` }}
      >
        <Trans>Warpath</Trans>
      </SectionHeading>
      <WarpathLines warpath={warpath} />
    </section>
  );
}

function GameCard({
  game,
  hideConquest,
  hideStats,
  hideWarpath,
}: {
  game: CareerGame;
  hideConquest: boolean;
  hideStats: boolean;
  hideWarpath: boolean;
}) {
  return (
    <section
      aria-labelledby={`career-${game.key}`}
      className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-4"
    >
      <h2
        id={`career-${game.key}`}
        className="flex items-center gap-3 text-base font-semibold"
      >
        <GameIcon name={game.title} />
        {game.title}
        {game.installed === false && (
          <Badge variant="outline" className="font-normal">
            <Trans>Not installed</Trans>
          </Badge>
        )}
      </h2>
      {game.campaigns.length > 0 && <CampaignsSection rows={game.campaigns} />}
      {game.conquest && !hideConquest && (
        <ConquestSection conquest={game.conquest} />
      )}
      {game.warpath && !hideWarpath && (
        <WarpathSection warpath={game.warpath} />
      )}
      {game.ai && <AiSection ai={game.ai} showLink={!hideStats} />}
    </section>
  );
}

/**
 * Runs from before Warpath kept a record per game, and runs with no game. They
 * cannot be given to a game, so they are shown once, apart from the game cards.
 * The link is only here when no game card has one.
 */
function LegacyWarpathCard({
  warpath,
  showLink,
}: {
  warpath: WarpathSummary;
  showLink: boolean;
}) {
  return (
    <section
      aria-labelledby="career-warpath"
      className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-4"
    >
      <h2
        id="career-warpath"
        className="flex items-center gap-2 text-base font-semibold"
      >
        <Trans>Earlier Warpath runs</Trans>
        {showLink && (
          <Link
            to="/warpath"
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "ml-auto",
            )}
          >
            <Trans>Open Warpath</Trans>
          </Link>
        )}
      </h2>
      <p className="text-xs text-muted-foreground">
        <Trans>
          Runs from before records were kept per game, or with no game recorded.
          What they unlocked is offered in every game.
        </Trans>
      </p>
      <WarpathLines warpath={warpath} />
    </section>
  );
}

/** Most earned achievements the summary draws, newest first. */
const SHOWN_ACHIEVEMENTS = 6;

function AchievementsSummary({
  status,
  achievements,
  statsLink,
}: {
  status: SourceStatus;
  achievements: AchievementResult[] | null;
  statsLink: boolean;
}) {
  const { t } = useLingui();
  // A failure is already named by the notice at the top of the page.
  if (status.state === "error") return null;
  const digest = achievements
    ? achievementDigest(achievements, SHOWN_ACHIEVEMENTS)
    : null;
  const left = digest ? digest.total - digest.shown.length : 0;
  const notEarned = digest ? digest.total - digest.earned : 0;
  const moreEarned = digest ? digest.earned - digest.shown.length : 0;
  const earned = digest?.earned ?? 0;
  const total = digest?.total ?? 0;
  return (
    <section
      aria-labelledby="career-achievements"
      className="rounded-lg border border-border/60 bg-card p-4"
    >
      <h3
        id="career-achievements"
        className="mb-1 flex items-center gap-2 text-sm font-medium"
      >
        <Trophy className="size-4 text-muted-foreground" />
        <Trans>Achievements</Trans>
        {digest && (
          <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
            <Trans>
              {earned} of {total} earned
            </Trans>
          </span>
        )}
      </h3>
      {status.state === "loading" && !digest && (
        <p className="text-sm text-muted-foreground">
          <Trans>Reading replay records…</Trans>
        </p>
      )}
      {status.state === "ready" && !digest && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            No replay records yet, so there are no achievements to show.
          </Trans>
        </p>
      )}
      {digest && digest.shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <Trans>None earned yet. {total} to go.</Trans>
        </p>
      )}
      {digest && digest.shown.length > 0 && (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {digest.shown.map((a) => (
            <AchievementRow key={a.id} a={a} />
          ))}
        </ul>
      )}
      {digest && left > 0 && digest.shown.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {moreEarned > 0
            ? t`${moreEarned} more earned, ${notEarned} not yet earned.`
            : t`${notEarned} not yet earned.`}
          {statsLink && (
            <>
              {" "}
              <Link to="/stats" className="text-primary hover:underline">
                <Trans>See them all on Player stats</Trans>
              </Link>
            </>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * The headline across every game: totals from what the page already loaded,
 * the player's achievements, and the way to their own stats page. Achievements
 * are one record for the player across all games (see `playerGameFacts`), so
 * they sit here and not in a game card.
 */
function Overview({
  data,
  hideConquest,
  hideWarpath,
  hideStats,
}: {
  data: CareerData;
  hideConquest: boolean;
  hideWarpath: boolean;
  hideStats: boolean;
}) {
  const { t } = useLingui();
  const { career, sources } = data;
  const totals = careerTotals(career);
  const aiWins = totals.aiWins;
  const conquestsFinished = totals.conquestsFinished;
  const campaignsStarted = totals.campaignsStarted;
  const cards: {
    key: string;
    icon: ReactNode;
    label: string;
    value: string;
    sub: string;
  }[] = [];
  const aiGames = totals.aiGames;
  const warpathRuns = totals.warpathRuns;
  const warpathWins = totals.warpathWins;
  if (aiGames > 0) {
    cards.push({
      key: "ai",
      icon: <Bot className="size-3.5" />,
      label: t`Games against AI`,
      value: plural(aiGames, { one: "# game", other: "# games" }),
      sub: t`${aiWins} won`,
    });
  }
  if (!hideConquest && totals.conquestsFinished > 0) {
    cards.push({
      key: "conquest",
      icon: <Orbit className="size-3.5" />,
      label: t`Conquests won`,
      value: String(totals.conquestsWon),
      sub: t`of ${conquestsFinished} finished`,
    });
  }
  if (
    !hideWarpath &&
    (career.legacyWarpath || career.games.some((g) => g.warpath))
  ) {
    cards.push({
      key: "warpath",
      icon: <Rocket className="size-3.5" />,
      label: t`Warpath`,
      value: plural(warpathRuns, { one: "# run", other: "# runs" }),
      sub: plural(warpathWins, { one: "# win", other: "# wins" }),
    });
  }
  if (totals.campaignsStarted > 0) {
    cards.push({
      key: "campaigns",
      icon: <Milestone className="size-3.5" />,
      label: t`Campaigns finished`,
      value: String(totals.campaignsFinished),
      sub: t`of ${campaignsStarted} started`,
    });
  }
  const statsTo = data.player
    ? `/stats/${encodeURIComponent(data.player)}`
    : "/stats";
  return (
    <section aria-labelledby="career-overview" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <h2 id="career-overview" className="text-base font-semibold">
          <Trans>Overview</Trans>
        </h2>
        {!hideStats && (
          <Link
            to={statsTo}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "ml-auto",
            )}
          >
            <Trans>Your player stats</Trans>
          </Link>
        )}
      </div>
      {cards.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
          {cards.map(({ key, ...card }) => (
            <StatCard key={key} {...card} />
          ))}
        </div>
      )}
      <AchievementsSummary
        status={sources.ai}
        achievements={data.achievements}
        statsLink={!hideStats}
      />
    </section>
  );
}

/** One line per source that has no answer, in the order the sections run. */
function SourceNotices({
  sources,
}: {
  sources: Record<SourceId, SourceStatus>;
}) {
  const { t } = useLingui();
  const sourceNotice = (id: SourceId, error: string) => {
    switch (id) {
      case "campaigns":
        return t`Campaign progress could not be read. Campaigns are not shown. ${error}`;
      case "conquest":
        return t`Conquest records could not be read. Conquests are not shown. ${error}`;
      case "warpath":
        return t`Warpath records could not be read. Warpath is not shown. ${error}`;
      case "ai":
        return t`Replay records could not be read. The record against AI and achievements are not shown. ${error}`;
      case "games":
        return t`The installed games could not be read. Games are matched by name only. ${error}`;
    }
  };
  const sourceName = (id: SourceId) => {
    switch (id) {
      case "campaigns":
        return t`campaign progress`;
      case "conquest":
        return t`conquest records`;
      case "warpath":
        return t`warpath records`;
      case "ai":
        return t`replay records`;
      case "games":
        return t`the installed games`;
    }
  };
  const failed = SOURCE_ORDER.filter((id) => sources[id].state === "error");
  const warned = SOURCE_ORDER.filter(
    (id) => sources[id].state === "ready" && sources[id].warning,
  );
  const loading = SOURCE_ORDER.filter((id) => sources[id].state === "loading");
  const stillReading = joinList(loading.map(sourceName));
  return (
    <>
      {failed.map((id) => (
        <ErrorBanner
          key={id}
          message={sourceNotice(id, sources[id].message ?? "")}
        />
      ))}
      {warned.map((id) => (
        <ErrorBanner key={id} message={sources[id].warning ?? ""} />
      ))}
      {loading.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t`Still reading: ${stillReading}`}
        </p>
      )}
    </>
  );
}

/** Where a new player can start, leaving out what the distribution hides. */
function StartPoints({
  hideConquest,
  hideWarpath,
}: {
  hideConquest: boolean;
  hideWarpath: boolean;
}) {
  const { t } = useLingui();
  const links = [
    { to: "/play/skirmish", label: t`a skirmish against AI` },
    { to: "/campaign", label: t`a campaign` },
    ...(hideConquest ? [] : [{ to: "/conquest", label: t`a Conquest` }]),
    ...(hideWarpath ? [] : [{ to: "/warpath", label: t`a Warpath run` }]),
  ];
  const byLabel = new Map(links.map((l) => [l.label, l]));
  let offset = 0;
  const options = new Intl.ListFormat(getLocale(), { type: "disjunction" })
    .formatToParts(links.map((l) => l.label))
    .map((part) => {
      const at = offset;
      offset += part.value.length;
      const link = part.type === "element" ? byLabel.get(part.value) : null;
      return link ? (
        <Link key={at} to={link.to} className="text-primary hover:underline">
          {link.label}
        </Link>
      ) : (
        <span key={at}>{part.value}</span>
      );
    });
  return (
    <EmptyState
      label={
        <Trans>
          Nothing to show yet. Your progress appears here as you play. Start
          with {options}.
        </Trans>
      }
    />
  );
}

/**
 * Career: how far the player has got in each game, across campaigns, Conquest,
 * Warpath and skirmishes against AI. It reads the stores those screens own and
 * keeps none of its own, and nothing on it can be edited. Each part links to the
 * screen that owns it. A summary at the top holds the totals and achievements.
 *
 * Each source loads and fails on its own: a failure is a line at the top and the
 * rest still draws.
 */
export default function CareerPage() {
  const data = useCareer();
  const { career, sources } = data;

  const hideConquest = isProfileHidden("conquest.list");
  const hideWarpath = isProfileHidden("runlite.list");
  const hideStats = isProfileHidden("multiplayer.stats");

  const games = career.games.filter(
    (g) =>
      g.campaigns.length > 0 ||
      g.ai ||
      (g.conquest && !hideConquest) ||
      (g.warpath && !hideWarpath),
  );
  const warpath = hideWarpath ? null : career.legacyWarpath;
  const empty = games.length === 0 && warpath === null;
  // Achievements come from replays of any kind, so they can exist with no game
  // card to show.
  const showOverview = !empty || data.achievements !== null;

  const states = (["campaigns", "conquest", "warpath", "ai"] as const).map(
    (id) => sources[id].state,
  );
  const answered = states.every((s) => s === "ready");
  const reading = states.includes("loading");

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold">
          <Award className="size-5 text-muted-foreground" />
          <Trans>Career</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans>
            Your progress in each game. It is read from your campaigns,
            Conquests, Warpath runs and replays, and nothing here can be
            changed.
          </Trans>
        </p>
      </header>

      <SourceNotices sources={sources} />

      {empty && reading && <SkeletonList />}
      {!showOverview && empty && answered && (
        <StartPoints hideConquest={hideConquest} hideWarpath={hideWarpath} />
      )}

      {showOverview && (
        <Overview
          data={data}
          hideConquest={hideConquest}
          hideWarpath={hideWarpath}
          hideStats={hideStats}
        />
      )}

      {games.map((game) => (
        <GameCard
          key={game.key}
          game={game}
          hideConquest={hideConquest}
          hideStats={hideStats}
          hideWarpath={hideWarpath}
        />
      ))}
      {warpath && (
        <LegacyWarpathCard
          warpath={warpath}
          showLink={!games.some((g) => g.warpath)}
        />
      )}
    </div>
  );
}
