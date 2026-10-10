import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { ChevronRight, Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notify } from "@/notify/notify";
import {
  contentWriteFile,
  type DemoInfo,
  type StoredReplayAnalysis,
  type UnitBuildpicsResult,
  type UnitDatasetEntry,
} from "../../bindings";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../../config";
import { useStoredAnalyses } from "../../replayAnalysis";
import {
  ALL_KINDS,
  ALL_PLAYERS,
  eventDetails,
  eventKinds,
  eventsDownloadText,
  eventsFileName,
  filterEvents,
  kindLabel,
  type LogEvent,
  pageOf,
  playerLabels,
  playerOptions,
  teamLabel,
} from "../../replayAnalysisEvents";
import {
  buildOrderTime,
  pickUnitSource,
  recordedGame,
  resolveBuildUnit,
  type UnitSource,
} from "../../replayBuildOrders";
import { readReplayEvents } from "../../replayEventRead";
import { ErrorBanner } from "./states";
import { UnitIcon } from "./UnitIcon";

/** How many rows are drawn at first, and added per press. A match can hold tens
 *  of thousands of events, and the build orders page theirs the same way. */
const PAGE = 100;

/** Where the unit names came from, or why there are none. */
function UnitNote({
  recorded,
  source,
  unitsFailed,
}: {
  recorded: string;
  source: UnitSource | null;
  unitsFailed: boolean;
}) {
  if (!source) return null;
  if (source.kind === "notInstalled") {
    return (
      <p className="text-xs text-muted-foreground">
        {recorded || "This replay's game"} is not installed, so the units cannot
        be named. Each event shows its unit definition id.
      </p>
    );
  }
  if (unitsFailed) {
    return (
      <p className="text-xs text-muted-foreground">
        The units of {source.game.name} could not be read, so each event shows
        its unit definition id.
      </p>
    );
  }
  if (source.kind === "differentBuild") {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        This replay was played on {recorded}, which is not installed. Unit names
        come from {source.game.name}, a different build, and may be wrong.
      </p>
    );
  }
  return null;
}

function DownloadButton({
  analysis,
  events,
  info,
}: {
  analysis: StoredReplayAnalysis;
  events: LogEvent[];
  info: DemoInfo;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const dest = await save({
        title: "Download the event log",
        defaultPath: eventsFileName(info, analysis.gameId),
        filters: [{ name: "JSON lines", extensions: ["jsonl"] }],
      });
      if (!dest) return;
      await contentWriteFile({
        dest,
        text: eventsDownloadText(analysis, events),
      });
      void notify({ title: "Event log downloaded.", level: "success" });
    } catch (e) {
      void notify({
        title: `Download failed: ${e instanceof Error ? e.message : e}`,
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={busy}
      title="Writes every event, whatever the filters show."
      onClick={download}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      Download log
    </Button>
  );
}

function unitName(
  unit: UnitDatasetEntry | undefined,
  def: number | undefined,
): string {
  if (unit) return unit.fullName || unit.name;
  return def === undefined ? "" : `Unit ${def}`;
}

/** The filters and the table, for one analysis whose events have arrived. */
function EventsTable({
  analysis,
  events,
  info,
}: {
  analysis: StoredReplayAnalysis;
  events: LogEvent[];
  info: DemoInfo;
}) {
  const [kind, setKind] = useState(ALL_KINDS);
  const [player, setPlayer] = useState(ALL_PLAYERS);
  const [shown, setShown] = useState(PAGE);

  const labels = useMemo(() => playerLabels(info), [info]);
  const kinds = useMemo(
    () => eventKinds(analysis.counts, events),
    [analysis.counts, events],
  );
  const players = useMemo(
    () => playerOptions(events, labels),
    [events, labels],
  );
  const matching = useMemo(
    () => filterEvents(events, { kind, player }, labels),
    [events, kind, player, labels],
  );
  const { rows, left } = pageOf(matching, shown);

  // Nothing is asked of unitsync until there are events to name.
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const recorded = recordedGame(info);
  const hasUnits = events.some((e) => typeof e.def === "number");
  const source =
    hasUnits && scan.data && !scan.loading
      ? pickUnitSource(recorded, scan.data.games)
      : null;
  const archive =
    source && source.kind !== "notInstalled"
      ? source.game.primaryArchive.name
      : undefined;
  const { dataset, status } = useUnitsyncUnitDataset(
    selected?.enginePath,
    selected?.rootPath,
    archive,
  );
  const units = archive && dataset ? dataset.units : null;
  const named = [
    ...new Set(
      rows.flatMap((e) =>
        typeof e.def === "number"
          ? (resolveBuildUnit(e.def, units)?.name ?? [])
          : [],
      ),
    ),
  ];
  const pics: UnitBuildpicsResult | null = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    archive,
    named,
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <OptionSelect
          ariaLabel="Kind of event"
          size="sm"
          value={kind}
          onValueChange={(v) => {
            setKind(v);
            setShown(PAGE);
          }}
          options={[
            { value: ALL_KINDS, label: "All kinds" },
            ...kinds.map((k) => ({ value: k, label: kindLabel(k) })),
          ]}
        />
        <OptionSelect
          ariaLabel="Player"
          size="sm"
          value={player}
          onValueChange={(v) => {
            setPlayer(v);
            setShown(PAGE);
          }}
          options={[{ value: ALL_PLAYERS, label: "All players" }, ...players]}
        />
        <DownloadButton analysis={analysis} events={events} info={info} />
      </div>
      {archive && status === "loading" ? (
        <p className="text-xs text-muted-foreground">Reading unit names…</p>
      ) : (
        <UnitNote
          recorded={recorded}
          source={source}
          unitsFailed={archive !== undefined && units === null}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {matching.length === events.length
          ? `${events.length.toLocaleString()} events.`
          : `${matching.length.toLocaleString()} of ${events.length.toLocaleString()} events match.`}
      </p>
      {matching.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No event matches these filters.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((event, i) => {
              const def = typeof event.def === "number" ? event.def : undefined;
              const unit =
                def === undefined ? undefined : resolveBuildUnit(def, units);
              const team =
                typeof event.team === "number" ? event.team : undefined;
              return (
                // Rows are never reordered, and two events can be identical.
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list with no other identity
                <TableRow key={i}>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {typeof event.frame === "number"
                      ? buildOrderTime(event.frame)
                      : ""}
                  </TableCell>
                  <TableCell>{kindLabel(event.kind)}</TableCell>
                  <TableCell>{teamLabel(team, labels)}</TableCell>
                  <TableCell>
                    {def !== undefined && (
                      <span className="flex items-center gap-2">
                        {unit && (
                          <UnitIcon
                            display={pics?.units[unit.name]}
                            pending={pics === null}
                            size="sm"
                          />
                        )}
                        {unitName(unit, def)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal break-words text-xs text-muted-foreground">
                    {eventDetails(event, labels)
                      .map((d) => `${d.name} ${d.text}`)
                      .join(", ")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {left > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShown((n) => n + PAGE)}
          >
            Show {Math.min(PAGE, left)} more of{" "}
            {matching.length.toLocaleString()}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Every event an analysis recorded, behind a disclosure (#1179). The events are
 * read when the disclosure is first opened, once, and filtered and paged here.
 *
 * It shows for a `current` or `outdated` analysis and for nothing else: the
 * analysis section says how to make one, and a `diverged` run holds no events.
 */
export function ReplayAnalysisEvents({
  replayPath,
  info,
}: {
  replayPath: string;
  info: DemoInfo;
}) {
  const analyses = useStoredAnalyses();
  const gameId = info.remixed ? undefined : info.gameId;
  const stored = gameId ? analyses.get(gameId) : undefined;
  const readable =
    stored && (stored.state === "current" || stored.state === "outdated")
      ? stored
      : undefined;

  const [open, setOpen] = useState(false);
  // What a read belongs to, so another replay or a newer run shows nothing of it.
  const atMs = readable?.analysedAtMs ?? 0;
  const key = readable ? `${replayPath}\n${atMs}` : null;
  const [read, setRead] = useState<{
    key: string;
    status: "failed" | "done";
    events: LogEvent[];
  } | null>(null);

  useEffect(() => {
    if (!open || key === null || !gameId) return;
    let stale = false;
    // Shared with the map's event layers, so each kind is read once.
    readReplayEvents(gameId, atMs, null).then(
      (events) => {
        if (!stale) setRead({ key, status: "done", events });
      },
      () => {
        if (!stale) setRead({ key, status: "failed", events: [] });
      },
    );
    return () => {
      stale = true;
    };
  }, [open, key, gameId, atMs]);

  if (!readable) return null;
  const current = read?.key === key ? read : null;
  const total = Object.values(readable.counts).reduce((a, n) => a + n, 0);

  return (
    <section className="flex flex-col gap-2">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="group justify-start gap-1.5"
          >
            <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
            <span className="font-medium">Recorded events</span>
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString()} {total === 1 ? "event" : "events"}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-2">
          <p className="text-xs text-muted-foreground">
            These are events from playing the match back, not orders.
          </p>
          {readable.state === "outdated" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              This analysis was recorded by an older logger and may lack newer
              kinds of event.
            </p>
          )}
          {current === null ? (
            <p className="text-sm text-muted-foreground">Reading events…</p>
          ) : current.status === "failed" ? (
            <ErrorBanner message="The events could not be read." />
          ) : (
            <EventsTable
              // Filters and paging start again for another replay or run.
              key={current.key}
              analysis={readable}
              events={current.events}
              info={info}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
