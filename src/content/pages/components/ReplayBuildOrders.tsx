import { Button } from "@picoframe/frame";
import { ChevronRight, Hammer, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  contentDemoBuildOrders,
  type DemoBuildOrders,
  type DemoInfo,
  type UnitBuildpicsResult,
  type UnitDatasetEntry,
} from "../../bindings";
import {
  useScanTargetSelection,
  useUnitsyncScan,
  useUnitsyncUnitBuildpics,
  useUnitsyncUnitDataset,
} from "../../config";
import {
  type BuildOrderSeat,
  buildOrderSeats,
  buildOrderTime,
  pickUnitSource,
  recordedGame,
  resolveBuildUnit,
  slotNote,
  type UnitSource,
} from "../../replayBuildOrders";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { ErrorBanner } from "./states";
import { UnitIcon } from "./UnitIcon";

/** How many of a seat's orders are drawn at first, and added per press. A long
 *  match has hundreds per player, and all of them at once is thousands of rows. */
const PAGE = 100;

/** Where the unit names came from, or why there are none. */
function SourceNote({
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
        be named. Each order shows the unit definition id the replay recorded.
      </p>
    );
  }
  if (unitsFailed) {
    return (
      <p className="text-xs text-muted-foreground">
        The units of {source.game.name} could not be read, so each order shows
        the unit definition id the replay recorded.
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
  return (
    <p className="text-xs text-muted-foreground">
      Unit names come from {source.game.name}, matched by name and version.
    </p>
  );
}

function SeatOrders({
  seat,
  units,
  pics,
  defaultOpen,
}: {
  seat: BuildOrderSeat;
  units: UnitDatasetEntry[] | null;
  pics: UnitBuildpicsResult | null;
  defaultOpen: boolean;
}) {
  const [shown, setShown] = useState(PAGE);
  const { pointTo } = useSeriesEmphasis();
  const left = seat.orders.length - shown;
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="rounded-lg border border-border/50 bg-card"
      {...(seat.team === undefined ? {} : pointTo([seat.team]))}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="group w-full justify-start gap-1.5"
        >
          <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
          <span className="font-medium">{seat.name}</span>
          <span className="text-xs text-muted-foreground">
            {seat.orders.length} {seat.orders.length === 1 ? "order" : "orders"}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto border-t border-border/50 p-3 text-sm">
          {seat.orders.slice(0, shown).map((order, i) => {
            const unit = resolveBuildUnit(order.unitDefId, units);
            const note = slotNote(order);
            return (
              // Orders are never reordered, and two can be identical.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list with no other identity
              <li key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {buildOrderTime(order.frame)}
                </span>
                {unit && (
                  <UnitIcon
                    display={pics?.units[unit.name]}
                    pending={pics === null}
                    size="sm"
                  />
                )}
                <span className="min-w-0 truncate">
                  {unit
                    ? unit.fullName || unit.name
                    : `Unit ${order.unitDefId}`}
                </span>
                {order.count > 1 && (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    ×{order.count}
                  </span>
                )}
                {note && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note}
                  </span>
                )}
                {order.position && (
                  <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
                    {Math.round(order.position.x)},{" "}
                    {Math.round(order.position.z)}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {left > 0 && (
          <div className="border-t border-border/50 p-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, left)} more of {left}
            </Button>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A replay's build orders, per player, loaded on demand (#1145).
 *
 * Mount it under a `SeriesEmphasisProvider`: pointing at a player's list
 * emphasises that player's team on the rest of the page.
 */
export function ReplayBuildOrders({
  replayPath,
  info,
}: {
  replayPath: string;
  info: DemoInfo;
}) {
  // The replay a read belongs to, so another replay shows nothing of it.
  const [read, setRead] = useState<{
    path: string;
    status: "loading" | "failed" | "done";
    result: DemoBuildOrders | null;
  } | null>(null);
  const latestPath = useRef(replayPath);
  latestPath.current = replayPath;

  const current = read?.path === replayPath ? read : null;
  const result = current?.result ?? null;
  const loading = current?.status === "loading";
  const failed = current?.status === "failed";

  const load = async () => {
    const path = replayPath;
    setRead({ path, status: "loading", result: null });
    try {
      const res = await contentDemoBuildOrders({ replayPath: path });
      if (latestPath.current !== path) return;
      setRead({ path, status: "done", result: res });
    } catch {
      if (latestPath.current !== path) return;
      setRead({ path, status: "failed", result: null });
    }
  };

  // Which installed game can name the ids, from the live scan the page's
  // missing-game notice reads. Nothing is asked of unitsync until there are
  // orders to name.
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const recorded = recordedGame(info);
  const source =
    result && result.orders.length > 0 && scan.data && !scan.loading
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
  const named = result
    ? [
        ...new Set(
          result.orders.flatMap(
            (o) => resolveBuildUnit(o.unitDefId, units)?.name ?? [],
          ),
        ),
      ]
    : [];
  const pics = useUnitsyncUnitBuildpics(
    selected?.enginePath,
    selected?.rootPath,
    archive,
    named,
  );

  const seats = result ? buildOrderSeats(result, info) : [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">Build orders</h2>
      {result === null ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="gap-1.5"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Hammer className="size-4" />
            )}
            {loading ? "Reading build orders…" : "Show build orders"}
          </Button>
          {failed && (
            <ErrorBanner message="The build orders could not be read from this replay." />
          )}
        </div>
      ) : seats.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No build orders were recorded in this replay.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            These are the orders each player gave, not what was built. An order
            that was cancelled or never carried out is listed like any other.
          </p>
          {archive && status === "loading" ? (
            <p className="text-xs text-muted-foreground">Reading unit names…</p>
          ) : (
            <SourceNote
              recorded={recorded}
              source={source}
              unitsFailed={archive !== undefined && units === null}
            />
          )}
          {seats.map((seat) => (
            <SeatOrders
              key={seat.key}
              seat={seat}
              units={units}
              pics={pics}
              defaultOpen={seats.length === 1}
            />
          ))}
          {result.removals > 0 && (
            <p className="text-xs text-muted-foreground">
              {result.removals}{" "}
              {result.removals === 1 ? "order that took" : "orders that took"}{" "}
              units off a factory queue {result.removals === 1 ? "is" : "are"}{" "}
              not listed.
            </p>
          )}
        </>
      )}
      {result?.incomplete && (
        <p className="text-xs text-muted-foreground">
          This replay could not be read to the end, so later build orders may be
          missing.
        </p>
      )}
    </section>
  );
}
