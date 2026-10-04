import { Award, Bot, Milestone, Orbit, Rocket } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import { MAX_THREAT_LEVEL } from "../../conquest/threat";
import {
  EmptyState,
  ErrorBanner,
  SkeletonList,
} from "../../content/pages/components/states";
import { isProfileHidden } from "../../profile/hidden";
import type {
  AiSummary,
  CampaignRow,
  CareerGame,
  ConquestSummary,
  WarpathSummary,
} from "../career";
import { type SourceId, type SourceStatus, useCareer } from "../useCareer";

/** What each source is called in a notice, and what its failure costs. */
const SOURCE_NOTICE: Record<SourceId, { name: string; effect: string }> = {
  campaigns: { name: "Campaign progress", effect: "Campaigns are not shown." },
  conquest: { name: "Conquest records", effect: "Conquests are not shown." },
  warpath: { name: "Warpath records", effect: "Warpath is not shown." },
  ai: {
    name: "Replay records",
    effect: "The record against AI is not shown.",
  },
  games: {
    name: "The installed games",
    effect: "Games are matched by name only.",
  },
};

const SOURCE_ORDER: SourceId[] = [
  "campaigns",
  "conquest",
  "warpath",
  "ai",
  "games",
];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

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
          className="ml-auto text-xs font-normal text-primary hover:underline"
        >
          {link.label}
        </Link>
      )}
    </h3>
  );
}

function CampaignsSection({ rows }: { rows: CampaignRow[] }) {
  return (
    <section className="flex flex-col">
      <SectionHeading icon={<Milestone className="size-4" />}>
        Campaigns
      </SectionHeading>
      <ul className="divide-y divide-border/40">
        {rows.map((row) => (
          <li key={row.id} className="flex items-baseline gap-3 py-1.5 text-sm">
            <Link
              to={`/campaign/${encodeURIComponent(row.id)}`}
              className="min-w-0 flex-1 truncate text-primary hover:underline"
            >
              {row.title}
            </Link>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {row.finished
                ? `Finished, ${plural(row.missions, "mission")}`
                : `${row.completed} of ${plural(row.missions, "mission")}`}
              {row.nextMission ? ` · next: ${row.nextMission}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConquestSection({ conquest }: { conquest: ConquestSummary }) {
  const parts = [
    `${conquest.won} won of ${conquest.finished} finished`,
    `highest threat level unlocked: ${conquest.threatLevel} of ${MAX_THREAT_LEVEL}`,
  ];
  if (conquest.inProgress > 0) {
    parts.push(`${conquest.inProgress} in progress`);
  }
  return (
    <section>
      <SectionHeading
        icon={<Orbit className="size-4" />}
        link={{ to: "/conquest", label: "Open Conquest" }}
      >
        Conquest
      </SectionHeading>
      <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>
    </section>
  );
}

function AiSection({ ai, showLink }: { ai: AiSummary; showLink: boolean }) {
  const result = [`${ai.wins}W`, `${ai.losses}L`];
  if (ai.undecided > 0) result.push(`${ai.undecided} undecided`);
  return (
    <section>
      <SectionHeading
        icon={<Bot className="size-4" />}
        link={
          showLink ? { to: "/stats", label: "Open Player stats" } : undefined
        }
      >
        Against AI
      </SectionHeading>
      <p className="text-sm text-muted-foreground">
        {plural(ai.games, "game")} · {result.join(" · ")}
        {ai.topAi
          ? ` · most played: ${ai.topAi.ai}${ai.topAi.bonus ? ` (${ai.topAi.bonus})` : ""}, ${plural(ai.topAi.games, "game")}`
          : ""}
      </p>
    </section>
  );
}

function GameCard({
  game,
  hideConquest,
  hideStats,
}: {
  game: CareerGame;
  hideConquest: boolean;
  hideStats: boolean;
}) {
  return (
    <section
      aria-labelledby={`career-${game.key}`}
      className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card p-4"
    >
      <h2
        id={`career-${game.key}`}
        className="flex items-center gap-2 text-base font-semibold"
      >
        {game.title}
        {game.installed === false && (
          <Badge variant="outline" className="font-normal">
            Not installed
          </Badge>
        )}
      </h2>
      {game.campaigns.length > 0 && <CampaignsSection rows={game.campaigns} />}
      {game.conquest && !hideConquest && (
        <ConquestSection conquest={game.conquest} />
      )}
      {game.ai && <AiSection ai={game.ai} showLink={!hideStats} />}
    </section>
  );
}

function WarpathCard({ warpath }: { warpath: WarpathSummary }) {
  return (
    <section
      aria-labelledby="career-warpath"
      className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-4"
    >
      <h2
        id="career-warpath"
        className="flex items-center gap-2 text-base font-semibold"
      >
        Warpath
        <Badge variant="outline" className="font-normal">
          All games
        </Badge>
        <Link
          to="/warpath"
          className="ml-auto text-xs font-normal text-primary hover:underline"
        >
          Open Warpath
        </Link>
      </h2>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Rocket className="size-4" />
        {plural(warpath.runs, "run")} · {plural(warpath.wins, "win")} · deepest
        column {warpath.deepest} · ascension tier {warpath.ascensionTier} of{" "}
        {warpath.maxAscension}
      </p>
      <p className="text-sm text-muted-foreground">
        Unlocked loadouts:{" "}
        {warpath.loadouts.length > 0 ? warpath.loadouts.join(", ") : "none yet"}
        {" · "}event pools:{" "}
        {warpath.eventPools.length > 0
          ? warpath.eventPools.join(", ")
          : "none yet"}
      </p>
    </section>
  );
}

/** One line per source that has no answer, in the order the sections run. */
function SourceNotices({
  sources,
}: {
  sources: Record<SourceId, SourceStatus>;
}) {
  const failed = SOURCE_ORDER.filter((id) => sources[id].state === "error");
  const warned = SOURCE_ORDER.filter(
    (id) => sources[id].state === "ready" && sources[id].warning,
  );
  const loading = SOURCE_ORDER.filter((id) => sources[id].state === "loading");
  return (
    <>
      {failed.map((id) => (
        <ErrorBanner
          key={id}
          message={`${SOURCE_NOTICE[id].name} could not be read. ${SOURCE_NOTICE[id].effect} ${sources[id].message}`}
        />
      ))}
      {warned.map((id) => (
        <ErrorBanner key={id} message={sources[id].warning ?? ""} />
      ))}
      {loading.length > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          Still reading:{" "}
          {loading.map((id) => SOURCE_NOTICE[id].name.toLowerCase()).join(", ")}
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
  const links = [
    { to: "/play/skirmish", label: "a skirmish against AI" },
    { to: "/campaign", label: "a campaign" },
    ...(hideConquest ? [] : [{ to: "/conquest", label: "a Conquest" }]),
    ...(hideWarpath ? [] : [{ to: "/warpath", label: "a Warpath run" }]),
  ];
  return (
    <EmptyState
      label={
        <>
          Nothing to show yet. Your progress appears here as you play. Start
          with{" "}
          {links.map((l, i) => (
            <span key={l.to}>
              {i > 0 && (i === links.length - 1 ? " or " : ", ")}
              <Link to={l.to} className="text-primary hover:underline">
                {l.label}
              </Link>
            </span>
          ))}
          .
        </>
      }
    />
  );
}

/**
 * Career: how far the player has got in each game, across campaigns, Conquest,
 * Warpath and skirmishes against AI. It reads the stores those screens own and
 * keeps none of its own, and nothing on it can be edited. Each part links to the
 * screen that owns it. Achievements stay on Player stats.
 *
 * Each source loads and fails on its own: a failure is a line at the top and the
 * rest still draws.
 */
export default function CareerPage() {
  const { career, sources } = useCareer();

  const hideConquest = isProfileHidden("conquest.list");
  const hideWarpath = isProfileHidden("runlite.list");
  const hideStats = isProfileHidden("multiplayer.stats");

  const games = career.games.filter(
    (g) => g.campaigns.length > 0 || g.ai || (g.conquest && !hideConquest),
  );
  const warpath = hideWarpath ? null : career.warpath;
  const empty = games.length === 0 && warpath === null;

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
          Career
        </h1>
        <p className="text-sm text-muted-foreground">
          Your progress in each game. It is read from your campaigns, Conquests,
          Warpath runs and replays, and nothing here can be changed.
        </p>
      </header>

      <SourceNotices sources={sources} />

      {empty && reading && <SkeletonList />}
      {empty && answered && (
        <StartPoints hideConquest={hideConquest} hideWarpath={hideWarpath} />
      )}

      {games.map((game) => (
        <GameCard
          key={game.key}
          game={game}
          hideConquest={hideConquest}
          hideStats={hideStats}
        />
      ))}
      {warpath && <WarpathCard warpath={warpath} />}
    </div>
  );
}
