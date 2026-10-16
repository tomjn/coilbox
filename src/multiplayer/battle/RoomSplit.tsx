/**
 * The drag handle between the battle room's members table and its chat, and
 * the state behind it.
 *
 * Written for a horizontal edge rather than taken from the member list's
 * `MemberListResizer`, which is a vertical handle. It follows the same shape: a
 * real separator that the arrow keys, Home and End move, a double-click resets,
 * and a screen reader reads the height out.
 *
 * With nothing stored the table is not given a height at all, so the room lays
 * out as it did before the handle existed.
 */

import { useSetting } from "@picoframe/frame";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  CHAT_MIN_FALLBACK,
  clampHeight,
  maxHeight,
  stepHeight,
  TABLE_MIN,
} from "./splitLimits";

/** The setting that holds the table's height, one for every battle room. */
export const ROOM_SPLIT_KEY = "multiplayer.battleRoomTableHeight";

interface Measures {
  /** Height of the column's content box. 0 until measured. */
  available: number;
  /** Height the table is drawn at now. 0 until measured. */
  drawn: number;
  /** The chat's minimum height in pixels. */
  chatMin: number;
  /** Height the table's contents need: the card's border and everything in it. 0 until measured. */
  content: number;
}

function px(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The height the table's contents need. The card inside the table is a plain
 * stack of blocks, so this is their heights plus the card's border. Summed
 * rather than read from `scrollHeight`, which never goes below the card's own
 * height and so could not show contents shorter than the split.
 */
function contentHeight(table: HTMLElement): number {
  const card = table.firstElementChild;
  if (!card) return 0;
  const style = getComputedStyle(card);
  let total = px(style.borderTopWidth) + px(style.borderBottomWidth);
  for (const child of card.children) {
    total += child.getBoundingClientRect().height;
  }
  return total;
}

/** Measure the column, the table and the chat's floor, kept current as the column resizes. */
function useMeasures(
  column: HTMLElement | null,
  table: HTMLElement | null,
): Measures {
  const [measures, setMeasures] = useState<Measures>({
    available: 0,
    drawn: 0,
    chatMin: CHAT_MIN_FALLBACK,
    content: 0,
  });
  useEffect(() => {
    if (!column || !table) return;
    const measure = () => {
      const style = getComputedStyle(column);
      const chat = table.nextElementSibling?.nextElementSibling;
      const chatMin = chat ? px(getComputedStyle(chat).minHeight) : 0;
      const next = {
        available:
          column.clientHeight - px(style.paddingTop) - px(style.paddingBottom),
        drawn: table.offsetHeight,
        chatMin: chatMin > 0 ? chatMin : CHAT_MIN_FALLBACK,
        content: contentHeight(table),
      };
      setMeasures((was) =>
        was.available === next.available &&
        was.drawn === next.drawn &&
        was.chatMin === next.chatMin &&
        was.content === next.content
          ? was
          : next,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(column);
    observer.observe(table);
    // The card's own height follows the split, so its contents are watched
    // instead. The spectator row comes and goes, so watch for new children too.
    const card = table.firstElementChild;
    const watchContents = () => {
      for (const child of card?.children ?? []) observer.observe(child);
    };
    const mutations = new MutationObserver(() => {
      watchContents();
      measure();
    });
    if (card) mutations.observe(card, { childList: true });
    watchContents();
    measure();
    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [column, table]);
  return measures;
}

export function useRoomSplit() {
  const [stored, setStored] = useSetting<number | null>(ROOM_SPLIT_KEY, null);
  const [dragging, setDragging] = useState<number | null>(null);
  // Elements held in state rather than refs: the room page returns early
  // until the battle exists, so the column mounts after this hook first runs.
  const [column, setColumn] = useState<HTMLElement | null>(null);
  const [table, setTable] = useState<HTMLElement | null>(null);
  const { available, drawn, chatMin, content } = useMeasures(column, table);
  const tableId = useId();

  // The stored height is clamped each time it is drawn and never rewritten for
  // it, so a height chosen in a tall window returns when the window does. A
  // drag in progress is held here and only stored when it ends.
  const chosen = dragging ?? stored;
  const height =
    chosen === null ? null : clampHeight(chosen, available, chatMin, content);

  const onChange = useCallback(
    (next: number | null, final: boolean) => {
      if (final) {
        setDragging(null);
        setStored(next);
      } else setDragging(next);
    },
    [setStored],
  );

  return {
    columnRef: setColumn,
    tableRef: setTable,
    tableId,
    tableStyle: (height === null ? undefined : { height }) as
      | CSSProperties
      | undefined,
    tableClass: height === null ? "" : "flex-none",
    handle: {
      // What a screen reader reads when nothing is stored: the height drawn now.
      height: height ?? clampHeight(drawn, available, chatMin, content),
      available,
      chatMin,
      content,
      controls: tableId,
      onChange,
    },
  };
}

interface HandleProps {
  /** The height the table is drawn at now, already inside the limits. */
  height: number;
  /** The column's content height. 0 until measured. */
  available: number;
  chatMin: number;
  /** Height the table's contents need. 0 until measured. */
  content: number;
  /** The id of the table this resizes, for `aria-controls`. */
  controls: string;
  /**
   * A new height, or null for the default. `final` is false while a drag is in
   * progress and true when it ends, and for a key press or a double-click, so
   * the caller can keep a drag out of storage until it is done.
   */
  onChange: (height: number | null, final: boolean) => void;
}

export function RoomSplitHandle({
  height,
  available,
  chatMin,
  content,
  controls,
  onChange,
}: HandleProps) {
  // Where the pointer went down and how tall the table was then, so a drag
  // tracks the pointer instead of accumulating rounding from each move.
  const start = useRef<{ y: number; height: number } | null>(null);
  const latest = useRef(height);

  return (
    // The negative margins take back the two column gaps this item would
    // otherwise add, so the space between table and chat is the one it had.
    <div className="relative -my-2 h-0 shrink-0">
      {/* biome-ignore lint/a11y/useSemanticElements: an <hr> is void, so it can carry neither the grip nor the drag */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the player table and chat"
        aria-controls={controls}
        aria-valuenow={height}
        aria-valuemin={TABLE_MIN}
        aria-valuemax={
          available > 0 ? maxHeight(available, chatMin, content) : height
        }
        tabIndex={0}
        className="group absolute inset-x-0 -top-1.5 z-10 flex h-3 cursor-row-resize items-center focus-visible:outline-none"
        onPointerDown={(event) => {
          event.preventDefault();
          start.current = { y: event.clientY, height };
          latest.current = height;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          latest.current = clampHeight(
            start.current.height + (event.clientY - start.current.y),
            available,
            chatMin,
            content,
          );
          onChange(latest.current, false);
        }}
        onPointerUp={(event) => {
          if (!start.current) return;
          start.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onChange(latest.current, true);
        }}
        onPointerCancel={() => {
          if (!start.current) return;
          start.current = null;
          onChange(latest.current, true);
        }}
        onDoubleClick={() => onChange(null, true)}
        onKeyDown={(event) => {
          const next = stepHeight(
            height,
            event.key,
            available,
            chatMin,
            content,
          );
          if (next === null) return;
          event.preventDefault();
          onChange(next, true);
        }}
      >
        {/* Nothing until the pointer is on it or it has focus. */}
        <span className="h-0.5 w-full rounded bg-transparent transition-colors group-hover:bg-ring group-focus-visible:bg-ring" />
      </div>
    </div>
  );
}
