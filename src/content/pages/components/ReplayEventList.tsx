import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { describeError } from "@/i18n/uiError";
import { formatNumber } from "@/lib/format";
import { scrollTopForRow, visibleRowWindow } from "@/lib/rowVirtualize";
import { cn } from "@/lib/utils";
import { notify } from "@/notify/notify";
import {
  contentWriteFile,
  type DemoInfo,
  type StoredReplayAnalysis,
} from "../../bindings";
import { analysisRunHidden, useStoredAnalyses } from "../../replayAnalysis";
import {
  ALL_KINDS,
  ALL_PLAYERS,
  eventKinds,
  eventsDownloadText,
  eventsFileName,
  kindLabel,
  playerLabels,
} from "../../replayAnalysisEvents";
import { resolveBuildUnit, type UnitSource } from "../../replayBuildOrders";
import {
  DEATH_KINDS,
  eventBlock,
  eventState,
  outdatedNote,
} from "../../replayEventLayers";
import {
  chatNames,
  describeRow,
  type EventRow,
  markedIndex,
  mergeRows,
  playerChoices,
  playerTeams,
  type RowFilter,
  rowKindLabel,
  rowTime,
  selectRows,
} from "../../replayEventList";
import { readReplayEvents } from "../../replayEventRead";
import { REPLAY_SOURCE_NOTES } from "../../replaySources";
import {
  useMatchClock,
  useMatchFrameValue,
  usePlaybackState,
} from "../../useMatchClock";
import { useReplayChat } from "../../useReplayChat";
import { useEventRead } from "../../useReplayEventLayers";
import { useReplayUnits } from "../../useReplayUnits";
import { SectionHelp } from "./SectionHelp";
import { ErrorBanner } from "./states";
import { StoredListNote } from "./UnitListNotes";

/** Pixels per row. Fixed, and applied to every row with an inline style, so the
 *  windowing and the layout cannot disagree about it. A long line is cut short
 *  on screen, and its whole text is the row's title. */
const ROW_HEIGHT = 32;

/** Rows drawn above and below those in view, so a fast scroll does not show a
 *  blank flash while the next window is worked out. */
const OVERSCAN = 8;

/** How tall the list is taken to be until it has been measured, which is a
 *  frame after it first draws. It only sizes the first window of rows. */
const UNMEASURED_HEIGHT = 480;

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
  const { t } = useLingui();
  if (!source) return null;
  const game = recorded || t`This replay's game`;
  if (source.kind === "notInstalled") {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>
          {game} is not installed, so the units cannot be named. Each event
          shows its unit definition id.
        </Trans>
      </p>
    );
  }
  if (source.kind === "stored") return <StoredListNote source={source} />;
  // An event's ids are never named from the replay's own list of names.
  if (source.kind === "replay") return null;
  const gameName = source.game.name;
  if (unitsFailed) {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>
          The units of {gameName} could not be read, so each event shows its
          unit definition id.
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
  return null;
}

/** Writes every logged event to a `.jsonl` file, whatever the list shows. */
function DownloadButton({
  analysis,
  info,
}: {
  analysis: StoredReplayAnalysis;
  info: DemoInfo;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const dest = await save({
        title: t`Download the event log`,
        defaultPath: eventsFileName(info, analysis.gameId),
        filters: [{ name: t`JSON lines`, extensions: ["jsonl"] }],
      });
      if (!dest) return;
      // The list reads only the kinds it shows. The file holds all of them.
      const events = await readReplayEvents(
        analysis.gameId,
        analysis.analysedAtMs,
        null,
      );
      await contentWriteFile({
        dest,
        text: eventsDownloadText(analysis, events),
      });
      void notify({ title: t`Event log downloaded.`, level: "success" });
    } catch (e) {
      const reason = describeError(e);
      void notify({
        title: t`Download failed: ${reason}`,
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
      className="ml-auto gap-1.5"
      disabled={busy}
      title={t`Writes every event, whatever the filters show.`}
      onClick={download}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      <Trans>Download log</Trans>
    </Button>
  );
}

/**
 * The rows in view of a list that scrolls inside itself. Only those rows, and a
 * few either side, are in the page.
 *
 * `marked` is the row at the scrubber's time. When it changes, the list scrolls
 * the least that puts it in view, and when the scrubber was moved to a row off
 * screen it puts it in the middle. While the match plays the list follows only
 * a reader who has the marked row in view, so one who scrolled away to read is
 * not pulled back.
 *
 * Only one row can be tabbed to, since a row out of the window is not in the
 * page. The arrow keys, Home and End move between rows.
 */
function VirtualRows({
  rows,
  marked,
  playing,
  renderRow,
  onPress,
}: {
  rows: readonly EventRow[];
  marked: number;
  playing: boolean;
  renderRow: (row: EventRow) => {
    time: string;
    kind: string;
    text: string;
  };
  onPress: (row: EventRow) => void;
}) {
  const { t } = useLingui();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [focusRow, setFocusRow] = useState<number | null>(null);

  useEffect(() => {
    if (!scroller) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportHeight(entry.contentRect.height);
      // A tab that was hidden has lost its place, and the page may have moved
      // the list while it was away.
      setScrollTop(scroller.scrollTop);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scroller]);

  const height = viewportHeight > 0 ? viewportHeight : UNMEASURED_HEIGHT;
  // A filter that shortens the list leaves `scrollTop` past its end for a
  // frame, and a window past the end is an empty list.
  const { start, end } = visibleRowWindow(
    Math.min(scrollTop, Math.max(0, rows.length * ROW_HEIGHT - height)),
    height,
    rows.length,
    ROW_HEIGHT,
    OVERSCAN,
  );

  const scrollTo = useCallback(
    (top: number) => {
      if (!scroller) return;
      scroller.scrollTop = top;
      setScrollTop(top);
    },
    [scroller],
  );

  /** Whether `row` is wholly on screen now. */
  const inView = useCallback(
    (row: number) => {
      if (!scroller) return false;
      const top = row * ROW_HEIGHT;
      return (
        top >= scroller.scrollTop &&
        top + ROW_HEIGHT <= scroller.scrollTop + viewportHeight
      );
    },
    [scroller, viewportHeight],
  );

  // What the last pass saw, so a change can be told from a first look. A new
  // list has new rows under the same numbers, so it starts again.
  const seen = useRef<{ rows: readonly EventRow[]; marked: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    // A list that is not laid out, as in a tab that is not open, cannot be
    // scrolled. It is looked at again when it has a height.
    if (!scroller || viewportHeight <= 0) return;
    const before = seen.current;
    seen.current = { rows, marked };
    if (marked < 0) return;
    const sameList = before?.rows === rows;
    if (sameList && before.marked === marked) return;
    if (inView(marked)) return;
    if (playing && sameList && before.marked >= 0 && !inView(before.marked)) {
      return;
    }
    const top = marked * ROW_HEIGHT;
    if (playing && sameList) {
      // One row at a time, as the match reaches it.
      scrollTo(
        top < scroller.scrollTop ? top : top + ROW_HEIGHT - viewportHeight,
      );
    } else {
      scrollTo(
        scrollTopForRow(marked, rows.length, viewportHeight, ROW_HEIGHT),
      );
    }
  }, [scroller, viewportHeight, rows, marked, playing, inView, scrollTo]);

  // A row waiting for keyboard focus, once the scroll has mounted it.
  useLayoutEffect(() => {
    if (focusRow === null) return;
    scroller
      ?.querySelector<HTMLButtonElement>(`[data-row="${focusRow}"]`)
      ?.focus();
    setFocusRow(null);
  }, [focusRow, scroller]);

  const moveFocus = (to: number) => {
    if (!scroller || rows.length === 0) return;
    const next = Math.min(rows.length - 1, Math.max(0, to));
    if (!inView(next)) {
      const top = next * ROW_HEIGHT;
      scrollTo(
        top < scroller.scrollTop ? top : top + ROW_HEIGHT - viewportHeight,
      );
    }
    setFocusRow(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const row = Number(
      (e.target as HTMLElement).closest("[data-row]")?.getAttribute("data-row"),
    );
    if (!Number.isInteger(row)) return;
    const to =
      e.key === "ArrowDown"
        ? row + 1
        : e.key === "ArrowUp"
          ? row - 1
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? rows.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    moveFocus(to);
  };

  // The marked row, or the first in the window, kept inside the window so
  // there is always one rendered row to tab on to.
  const tabStop = Math.min(
    Math.max(marked < 0 ? 0 : marked, start),
    Math.max(start, end - 1),
  );

  return (
    <div
      ref={setScroller}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      className="min-h-64 flex-1 overflow-y-auto rounded-lg border border-border/50 bg-card"
    >
      {/* The length of the whole list, so the scrollbar is the size of the
       * match and not of the rows in the page. */}
      <div style={{ height: rows.length * ROW_HEIGHT }}>
        <ul
          aria-label={t`Events and chat`}
          onKeyDown={onKeyDown}
          style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}
        >
          {rows.slice(start, end).map((row, i) => {
            const index = start + i;
            const { time, kind, text } = renderRow(row);
            return (
              <li
                // Rows are never reordered, and two events can be identical.
                key={index}
                aria-posinset={index + 1}
                aria-setsize={rows.length}
              >
                <button
                  type="button"
                  data-row={index}
                  aria-current={index === marked ? "true" : undefined}
                  tabIndex={index === tabStop ? 0 : -1}
                  title={text}
                  style={{ height: ROW_HEIGHT }}
                  onClick={() => onPress(row)}
                  className={cn(
                    "grid w-full grid-cols-[3.5rem_4.5rem_minmax(0,1fr)] items-center gap-2 border-l-2 border-transparent px-3 text-left text-sm hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
                    index === marked && "border-primary bg-primary/10",
                  )}
                >
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {time}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {kind}
                  </span>
                  <span className="truncate">{text}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * Chat, player events and the analysis's logged events as one list in time
 * order (#5320), for the "Events and chat" tab.
 *
 * It opens on chat, kills and player events together ("Highlights"). "All" adds
 * every logged event. Choosing a kind of logged event switches to "All", and
 * choosing a filter clears the kind, so the two never leave an empty list
 * between them. A replay with no analysis lists chat and player events only.
 *
 * Only kills are read from the analysis until a reader asks for more, since a
 * match can log many thousands of events. The row at the scrubber's time is
 * marked, and pressing a row moves the scrubber to it.
 */
export function ReplayEventList({
  info,
  replayPath,
  showAnalysis,
}: {
  info: DemoInfo;
  replayPath: string;
  /** False when the profile hides the analysis, which leaves chat and players. */
  showAnalysis: boolean;
}) {
  const { t } = useLingui();
  const { playback, range } = useMatchClock();
  const { playing } = usePlaybackState();

  const chat = useReplayChat(replayPath);
  const analyses = useStoredAnalyses();
  const stored =
    !showAnalysis || info.remixed || !info.gameId
      ? undefined
      : analyses.get(info.gameId);
  const state = eventState(info, stored, analysisRunHidden());
  const analysed = state.kind === "ready" && stored !== undefined;

  const [filter, setFilter] = useState<RowFilter>("highlights");
  const [kind, setKind] = useState(ALL_KINDS);
  const [player, setPlayer] = useState(ALL_PLAYERS);

  // Without an analysis there is no "other" kind of event, so Highlights and
  // All are one list and the first is not offered.
  const offered: RowFilter[] = analysed
    ? ["highlights", "all", "chat", "kills", "players"]
    : ["all", "chat", "players"];
  const active = offered.includes(filter) ? filter : (offered[0] as RowFilter);
  const wantsAll = analysed && (active === "all" || kind !== ALL_KINDS);

  const kills = useEventRead(state, DEATH_KINDS, analysed);
  const everything = useEventRead(state, null, wantsAll);
  const logged =
    everything.status === "done" ? everything.events : kills.events;
  const readFailed =
    (analysed && kills.status === "failed") ||
    (wantsAll && everything.status === "failed");
  const reading = wantsAll && everything.status === "loading";

  const labels = useMemo(() => playerLabels(info), [info]);
  const teamOf = useMemo(() => playerTeams(info.players), [info.players]);
  const names = useMemo(() => chatNames(chat.messages ?? []), [chat.messages]);
  const rows = useMemo(
    () => mergeRows(chat.messages ?? [], chat.events, logged, teamOf),
    [chat.messages, chat.events, logged, teamOf],
  );
  const visible = useMemo(
    () => selectRows(rows, { filter: active, kind, player }, labels),
    [rows, active, kind, player, labels],
  );
  const players = useMemo(
    () => playerChoices(labels, logged),
    [labels, logged],
  );
  const kinds = useMemo(
    () => (stored ? eventKinds(stored.counts, []) : []),
    [stored],
  );

  const hasUnits = logged.some((e) => typeof e.def === "number");
  const { recorded, source, archive, status, units } = useReplayUnits(
    info,
    hasUnits,
    "events",
  );
  const unitName = useCallback(
    (def: number) => {
      const unit = resolveBuildUnit(def, units);
      return unit ? unit.fullName || unit.name : t`Unit ${def}`;
    },
    [units, t],
  );

  // Select the row and not the frame, so the list renders when the marked row
  // changes and not on every frame of playback.
  const marked = useMatchFrameValue((frame) => markedIndex(visible, frame));

  const renderRow = useCallback(
    (row: EventRow) => ({
      time: rowTime(row.frame, range),
      kind: rowKindLabel(row),
      text: describeRow(row, { names, unitName, labels }),
    }),
    [range, names, unitName, labels],
  );

  const total = formatNumber(rows.length);
  const matching = formatNumber(visible.length);
  const filterNames: Record<RowFilter, string> = {
    highlights: t`Highlights`,
    all: t`All`,
    chat: t`Chat`,
    kills: t`Kills`,
    players: t`Players`,
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-sm font-medium">
          <Trans>Events and chat</Trans>
        </h2>
        <SectionHelp
          section={t`the events and chat`}
          source={analysed ? "log" : "stream"}
        >
          {analysed && (
            <p className="text-muted-foreground">
              {REPLAY_SOURCE_NOTES.stream}
            </p>
          )}
        </SectionHelp>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={active}
          // Radix clears the value when the lit filter is pressed again, and a
          // list with no filter has no meaning, so an empty change is ignored.
          onValueChange={(v) => {
            if (!v) return;
            setFilter(v as RowFilter);
            setKind(ALL_KINDS);
          }}
          aria-label={t`Show`}
        >
          {offered.map((id) => (
            <ToggleGroupItem key={id} value={id}>
              {filterNames[id]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {analysed && (
          <OptionSelect
            ariaLabel={t`Kind of event`}
            size="sm"
            className="w-auto"
            value={kind}
            onValueChange={(v) => {
              setKind(v);
              if (v !== ALL_KINDS) setFilter("all");
            }}
            options={[
              { value: ALL_KINDS, label: t`All kinds` },
              ...kinds.map((k) => ({ value: k, label: kindLabel(k) })),
            ]}
          />
        )}
        <OptionSelect
          ariaLabel={t`Player`}
          size="sm"
          className="w-auto"
          value={player}
          onValueChange={setPlayer}
          options={[{ value: ALL_PLAYERS, label: t`All players` }, ...players]}
        />
        {stored && analysed && <DownloadButton analysis={stored} info={info} />}
      </div>
      {state.kind === "ready" && state.outdated && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {outdatedNote()}
        </p>
      )}
      {showAnalysis && state.kind !== "ready" && (
        <p className="text-xs text-muted-foreground">{eventBlock(state)}</p>
      )}
      {chat.failed && (
        <ErrorBanner
          message={t`The chat could not be read from this replay.`}
        />
      )}
      {readFailed && <ErrorBanner message={t`The events could not be read.`} />}
      {chat.incomplete && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            This replay could not be read to the end, so the list may be
            incomplete.
          </Trans>
        </p>
      )}
      {archive && status === "loading" ? (
        <p className="text-xs text-muted-foreground">
          <Trans>Reading unit names…</Trans>
        </p>
      ) : (
        <UnitNote
          recorded={recorded}
          source={source}
          unitsFailed={archive !== undefined && units === null}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {chat.loading || reading
          ? t`Reading events…`
          : visible.length === rows.length
            ? plural(rows.length, { one: "# entry.", other: "# entries." })
            : t`${matching} of ${total} entries match.`}
      </p>
      {visible.length === 0 ? (
        !chat.loading &&
        !reading && (
          <p className="text-sm text-muted-foreground">
            {rows.length === 0 ? (
              <Trans>Nothing was recorded for this replay.</Trans>
            ) : (
              <Trans>No entry matches these filters.</Trans>
            )}
          </p>
        )
      ) : (
        <VirtualRows
          rows={visible}
          marked={marked}
          playing={playing}
          renderRow={renderRow}
          onPress={(row) => playback.seek(row.frame)}
        />
      )}
    </section>
  );
}
