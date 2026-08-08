import {
  Clock,
  Coins,
  Factory,
  Loader2,
  Swords,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  DemoInfo,
  DemoTrailer,
  Metric,
  MetricGroup,
} from "../../bindings";
import { contentMetricRegistry, contentReplayTrailer } from "../../bindings";
import {
  formatDuration,
  hasStatistics,
  headlineTotals,
  resultLabel,
  seatCount,
} from "../../matchStats";
import { StatCard } from "./StatWidgets";

/**
 * How a match actually went, under the roster on replay detail.
 *
 * The figures come from the replay's own trailer, read here rather than during
 * library ingest: a long team game is tens of thousands of numbers and the stats
 * store is one JSON file written whole (#1132). So this section fetches on its
 * own and the rest of the page renders without waiting for it.
 *
 * Which totals get a tile is the registry's `headline` flag, read at runtime.
 * Nothing in this file names a metric.
 */

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Decoded trailers, kept for the session: decoding re-reads the whole file. */
const trailerCache = new Map<string, DemoTrailer>();

/** The registry is static, so every surface shares one fetch of it. */
let registryPromise: Promise<Metric[]> | null = null;
function metricRegistry(): Promise<Metric[]> {
  registryPromise ??= contentMetricRegistry(undefined)
    .then((r) => r.metrics)
    .catch((e) => {
      // Don't keep a failure: the next section to open should ask again.
      registryPromise = null;
      throw e;
    });
  return registryPromise;
}

function useMatchStats(replayPath: string) {
  const [data, setData] = useState<{
    trailer: DemoTrailer;
    metrics: Metric[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    const cached = trailerCache.get(replayPath);
    const trailer = cached
      ? Promise.resolve(cached)
      : contentReplayTrailer({ replayPath }).then((r) => r.trailer);
    Promise.all([trailer, metricRegistry()])
      .then(([t, metrics]) => {
        if (cancelled) return;
        trailerCache.set(replayPath, t);
        setData({ trailer: t, metrics });
      })
      .catch((e) => {
        if (!cancelled) setError(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [replayPath]);

  return { data, loading, error };
}

/** A metric's icon comes from its group, so the next metric arrives with one. */
const groupIcon: Record<MetricGroup, React.ReactNode> = {
  economy: <Coins className="size-3.5" />,
  military: <Swords className="size-3.5" />,
  units: <Factory className="size-3.5" />,
};

/**
 * Nothing to show, and why. A replay whose recording was abandoned, or whose
 * trailer coilbox can't read, has no statistics at all, which is a different
 * thing from a match where every figure happened to be zero.
 */
function NoStatistics({ detail }: { detail: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-dashed p-4">
      <p className="text-sm">This replay has no statistics.</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

/** The headline tiles: the match itself, then the registry's totals. */
function Headlines({
  info,
  trailer,
  metrics,
}: {
  info: DemoInfo;
  trailer: DemoTrailer;
  metrics: Metric[];
}) {
  const bots = info.ais?.length ?? 0;
  const measured = trailer.teams.filter((t) => t.samples.length > 0).length;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      <StatCard
        icon={<Clock className="size-3.5" />}
        label="Duration"
        value={formatDuration(info.durationSec)}
      />
      <StatCard
        icon={<Trophy className="size-3.5" />}
        label="Result"
        value={resultLabel(info)}
      />
      <StatCard
        icon={<Users className="size-3.5" />}
        label="Players"
        value={String(seatCount(info))}
        sub={bots > 0 ? `${bots} of them bots` : undefined}
      />
      {headlineTotals(trailer, metrics).map((h) => (
        <StatCard
          key={h.metric.key}
          icon={groupIcon[h.metric.group]}
          label={h.metric.label}
          value={h.text}
          sub={measured === 1 ? "one team" : `across ${measured} teams`}
        />
      ))}
    </div>
  );
}

export function MatchStatsSection({
  info,
  replayPath,
}: {
  info: DemoInfo;
  replayPath: string;
}) {
  const { data, loading, error } = useMatchStats(replayPath);

  function body() {
    if (loading) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Reading this replay's statistics…
        </div>
      );
    }
    if (error) {
      return <NoStatistics detail={`Its trailer couldn't be read: ${error}`} />;
    }
    if (!data) return null;
    if (!hasStatistics(data.trailer)) {
      // Not always an abandoned recording: three of the replays this was built
      // against name a winner and still carry no samples at all (#1190). So this
      // says what the file shows and doesn't pick a reason for it.
      return (
        <NoStatistics detail="The engine wrote none for it. Either the recording was abandoned, or the match ended without its statistics ever being written." />
      );
    }
    return (
      <>
        <Headlines info={info} trailer={data.trailer} metrics={data.metrics} />
        {/* The chart block belongs here (#1136), with its metric picker, its
         * per-minute view and its readout in #1137, #1138 and #1140. What it
         * needs is in scope already: `data.trailer.teams` is one series of
         * running totals per team against `frame`, `teamStatPeriodSec` turns a
         * frame into a time, `data.metrics` is the registry it chooses from,
         * and `info` names, colours and sides every team. */}
      </>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Match statistics</h2>
      {body()}
    </section>
  );
}
