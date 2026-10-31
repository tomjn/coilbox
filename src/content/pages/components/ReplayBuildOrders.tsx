import { plural } from "@lingui/core/macro";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { ChevronRight, Hammer, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Field } from "@/components/Field";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { formatNumber } from "@/lib/format";
import type {
  DemoInfo,
  UnitBuildpicsResult,
  UnitDatasetEntry,
} from "../../bindings";
import { useUnitsyncUnitBuildpics } from "../../config";
import {
  type BuildOrderSeat,
  buildOrderSeats,
  buildOrderTime,
  resolveBuildUnit,
  slotNote,
  type UnitSource,
} from "../../replayBuildOrders";
import {
  collapseOrders,
  orderedCost,
  orderedSplit,
  ordersUpTo,
  parseCutMinutes,
} from "../../replayOpening";
import { orderFit } from "../../replayUnitDefs";
import { useReplayBuildOrders } from "../../useReplayBuildOrders";
import { useKeepUnitList, useReplayUnits } from "../../useReplayUnits";
import { useSeriesEmphasis } from "../../useSeriesEmphasis";
import { OpeningSplitHelp, ReplayOpeningSplit } from "./ReplayOpeningSplit";
import { SectionHelp } from "./SectionHelp";
import { ErrorBanner } from "./states";
import { UnitIcon } from "./UnitIcon";
import { OrderFitNote, StoredListNote, UnitListHelp } from "./UnitListNotes";

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
  const { t } = useLingui();
  if (!source) return null;
  if (source.kind === "notInstalled") {
    const game = recorded || t`This replay's game`;
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>
          {game} is not installed, so the units cannot be named. Each order
          shows the unit definition id the replay recorded.
        </Trans>
      </p>
    );
  }
  if (source.kind === "stored") return <StoredListNote source={source} />;
  const gameName = source.game.name;
  if (unitsFailed) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>
          The units of {gameName} could not be read, so each order shows the
          unit definition id the replay recorded.
        </Trans>
      </p>
    );
  }
  if (source.kind === "differentBuild") {
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400">
        <Trans>
          This replay was played on {recorded}, which is not installed. Unit
          names come from {gameName}, a different build, and may be wrong.
        </Trans>
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      <Trans>
        Unit names come from {gameName}, matched by name and version.
      </Trans>
    </p>
  );
}

/** What a unit is called in a row: its full name, else its internal one, else
 *  the id the replay recorded. */
function unitLabel(
  unit: UnitDatasetEntry | undefined,
  fallback: string,
): string {
  return unit ? unit.fullName || unit.name : fallback;
}

/**
 * A seat's orders folded into a short sequence, and what they add up to. The
 * stretch is the whole list unless the reader cut it at a minute.
 */
function SeatOpening({
  seat,
  units,
  pics,
  noPictures,
  cutMinutes,
  differentBuild,
}: {
  seat: BuildOrderSeat;
  units: UnitDatasetEntry[] | null;
  pics: UnitBuildpicsResult | null;
  /** No installed game can be asked for a picture, so none is on its way. */
  noPictures: boolean;
  cutMinutes: number | null;
  differentBuild: boolean;
}) {
  const { t } = useLingui();
  const [shown, setShown] = useState(PAGE);
  const inStretch = ordersUpTo(seat.orders, cutMinutes);
  const entries = collapseOrders(inStretch);
  const left = entries.length - shown;
  // Costs need the game's definitions. Without them there is nothing to add.
  const cost = units ? orderedCost(inStretch, units) : null;
  const moreCount = Math.min(PAGE, left);
  const entryCount = entries.length;
  const metal = cost ? formatNumber(cost.metal) : "";
  const energy = cost ? formatNumber(cost.energy) : "";
  return (
    <div className="flex flex-col gap-1 border-t border-border/50 p-3 text-sm">
      <h3 className="text-xs font-medium">
        {cutMinutes === null ? t`Opening` : t`Opening, first ${cutMinutes} min`}
      </h3>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans>No orders were given in this stretch.</Trans>
        </p>
      ) : (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {entries.slice(0, shown).map((entry, i) => {
            const unit = resolveBuildUnit(entry.unitDefId, units);
            const note = slotNote(entry.first);
            return (
              // Entries are never reordered, and two can be identical.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list with no other identity
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 shrink-0 tabular-nums text-xs text-muted-foreground">
                  {buildOrderTime(entry.frame)}
                </span>
                {unit && (
                  <UnitIcon
                    display={pics?.units[unit.name]}
                    pending={pics === null && !noPictures}
                    size="sm"
                  />
                )}
                <span className="min-w-0 truncate">
                  {unitLabel(unit, t`Unit ${entry.unitDefId}`)}
                </span>
                {entry.count > 1 && (
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    ×{entry.count}
                  </span>
                )}
                {entry.first.origin.kind === "lua" && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <Trans>from a widget</Trans>
                  </span>
                )}
                {note && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {note}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {left > 0 && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShown((n) => n + PAGE)}
          >
            <Trans>
              Show {moreCount} more of {entryCount} entries
            </Trans>
          </Button>
        </div>
      )}
      {cost && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Ordered cost: {metal} metal and {energy} energy.
          </Trans>
          {cost.unpriced > 0 && (
            <>
              {" "}
              <Plural
                value={cost.unpriced}
                one="# unit could not be priced and is left out."
                other="# units could not be priced and are left out."
              />
            </>
          )}
          {differentBuild && (
            <span className="text-amber-600 dark:text-amber-400">
              {" "}
              <Trans>
                These costs come from a different build and may be wrong.
              </Trans>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function SeatOrders({
  seat,
  units,
  pics,
  noPictures,
  defaultOpen,
  cutMinutes,
  differentBuild,
}: {
  seat: BuildOrderSeat;
  units: UnitDatasetEntry[] | null;
  pics: UnitBuildpicsResult | null;
  noPictures: boolean;
  defaultOpen: boolean;
  cutMinutes: number | null;
  differentBuild: boolean;
}) {
  const { t } = useLingui();
  const [shown, setShown] = useState(PAGE);
  const { pointTo } = useSeriesEmphasis();
  const left = seat.orders.length - shown;
  const moreCount = Math.min(PAGE, left);
  const orderCount = seat.orders.length;
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
            {plural(orderCount, { one: "# order", other: "# orders" })}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <SeatOpening
          seat={seat}
          units={units}
          pics={pics}
          noPictures={noPictures}
          cutMinutes={cutMinutes}
          differentBuild={differentBuild}
        />
        <h3 className="border-t border-border/50 px-3 pt-3 text-xs font-medium">
          <Trans>All orders</Trans>
        </h3>
        <ol className="flex max-h-96 flex-col gap-1 overflow-y-auto p-3 text-sm">
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
                    pending={pics === null && !noPictures}
                    size="sm"
                  />
                )}
                <span className="min-w-0 truncate">
                  {unitLabel(unit, t`Unit ${order.unitDefId}`)}
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
              <Trans>
                Show {moreCount} more of {orderCount}
              </Trans>
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
  const { t } = useLingui();
  const { result, loading, failed, load } = useReplayBuildOrders(replayPath);
  const [cut, setCut] = useState("");

  // Which installed game can name the ids, from the live scan the page's
  // missing-game notice reads. Nothing is asked of unitsync until there are
  // orders to name.
  const {
    selected,
    recorded,
    source,
    archive,
    picturesArchive,
    status,
    units,
    links,
    matchListVersion,
  } = useReplayUnits(info, result !== null && result.orders.length > 0);
  // The list just read is kept for this replay, so it can still be named when
  // the game has moved on. Only a list the replay's own orders agree with.
  useKeepUnitList(
    info,
    source,
    units,
    result?.orders ?? null,
    links,
    matchListVersion,
  );
  const fit = useMemo(
    () => (result && units ? orderFit(result.orders, units) : null),
    [result, units],
  );
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
    picturesArchive,
    named,
  );

  const seats = result ? buildOrderSeats(result, info) : [];

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">
          <Trans>Build orders</Trans>
        </h2>
        <SectionHelp section={t`build orders`} source="stream">
          {seats.length > 0 && (
            <>
              <p>
                <Trans>
                  These are the orders each player gave, not what was built. An
                  order that was cancelled or never carried out is listed like
                  any other.
                </Trans>
              </p>
              <p>
                <Trans>
                  Each player's opening is their orders folded into a sequence,
                  with repeats shown as a count.
                </Trans>
              </p>
              {units && <OpeningSplitHelp />}
              <UnitListHelp fit={fit} />
              {result && result.removals > 0 && (
                <p>
                  <Plural
                    value={result.removals}
                    one="# order that took units off a factory queue is not listed."
                    other="# orders that took units off a factory queue are not listed."
                  />
                </p>
              )}
            </>
          )}
        </SectionHelp>
      </div>
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
            {loading ? t`Reading build orders…` : t`Show build orders`}
          </Button>
          {failed && (
            <ErrorBanner
              message={t`The build orders could not be read from this replay.`}
            />
          )}
        </div>
      ) : seats.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          <Trans>No build orders were recorded in this replay.</Trans>
        </p>
      ) : (
        <>
          {archive && status === "loading" ? (
            <p className="text-xs text-muted-foreground">
              <Trans>Reading unit names…</Trans>
            </p>
          ) : (
            <SourceNote
              recorded={recorded}
              source={source}
              unitsFailed={archive !== undefined && units === null}
            />
          )}
          {fit && <OrderFitNote fit={fit} />}
          <Field label={t`Opening length in minutes`} className="max-w-sm">
            <Input
              inputMode="decimal"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              placeholder={t`Whole match`}
              className="h-8 w-24"
              autoComplete="off"
            />
          </Field>
          {units && (
            <ReplayOpeningSplit
              rows={seats.map((seat) => ({
                key: seat.key,
                name: seat.name,
                split: orderedSplit(
                  ordersUpTo(seat.orders, parseCutMinutes(cut)),
                  units,
                ),
              }))}
              cutMinutes={parseCutMinutes(cut)}
              differentBuild={source?.kind === "differentBuild"}
            />
          )}
          {seats.map((seat) => (
            <SeatOrders
              key={seat.key}
              seat={seat}
              units={units}
              pics={pics}
              noPictures={picturesArchive === undefined}
              defaultOpen={seats.length === 1}
              cutMinutes={parseCutMinutes(cut)}
              differentBuild={source?.kind === "differentBuild"}
            />
          ))}
        </>
      )}
      {result?.incomplete && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            This replay could not be read to the end, so later build orders may
            be missing.
          </Trans>
        </p>
      )}
    </section>
  );
}
