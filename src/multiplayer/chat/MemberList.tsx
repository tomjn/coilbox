import { cn, useSetting } from "@picoframe/frame";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { User } from "../bindings";
import { NameMarkIcon } from "../NameMarkIcon";
import { NAME_MARK_CLASS, type NameMark } from "../nameMark";
import { CountryFlag, RankBadge, RatingBadge } from "../UserBadges";
import { MemberListResizer } from "./MemberListResizer";
import { clampWidth, DEFAULT_WIDTH } from "./memberListWidth";
import { PRESENCE_META, type Presence } from "./presence";

/** The setting that holds the list's width, one for every channel. */
export const MEMBER_LIST_WIDTH_KEY = "multiplayer.memberListWidth";

/** The width of the element holding `ref`'s parent, kept current as it resizes. 0 until measured. */
function useParentWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const parent = ref.current?.parentElement;
    if (!parent) return;
    const measure = () => setWidth(parent.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    measure();
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * A reusable member panel: the users in the active conversation. A row is a
 * presence dot, the name, then rank, rating and flag at the right edge, and
 * whatever `renderActions` gives it as a trailing menu (issue #3695). Clicking a
 * member (when `onSelect` is given) starts a DM.
 */
export function MemberList({
  members,
  onSelect,
  colorFor,
  presenceFor,
  isIgnored,
  noteFor,
  markFor,
  renderActions,
}: {
  members: User[];
  onSelect?: (username: string) => void;
  /** Optional per-member accent colour (`#rrggbb`), e.g. a battle player's team
   * colour, shown as a swatch. Returns undefined when there's no colour. */
  colorFor?: (username: string) => string | undefined;
  /** Optional per-member presence (in-game/in-battle/away/online/offline),
   * shown as a coloured dot with its label in a tooltip. */
  presenceFor?: (username: string) => Presence;
  /** Whether a member is currently on the ignore list, which dims them. */
  isIgnored?: (username: string) => boolean;
  /** Current private note for a member ("" for none), shown in the name's
   * tooltip. Given the full `User` so callers can key it on account id rather
   * than name (issue #341). */
  noteFor?: (user: User) => string;
  /** Who a member is to the player (themselves, a friend, in their party),
   * which colours the name and puts a labelled glyph after it (issue #336). */
  markFor?: (username: string) => NameMark | null;
  /** Optional trailing per-member control, the row's menu. Returns a node to
   * render at the end of the row, or null/undefined to render nothing for it. */
  renderActions?: (user: User) => ReactNode;
}) {
  // Reserve the swatch column only when at least one member has a colour, so
  // colour-less members (e.g. the host) still line up, while plain channel/DM
  // lists (no colours at all) stay flush without a leading gap.
  const showSwatches = colorFor ? members.some((u) => colorFor(u.name)) : false;

  // The stored width is clamped each time it is drawn and never rewritten for
  // it, so a width chosen in a big window returns when the window does. A drag
  // in progress is held here and only stored when it ends.
  const [stored, setStored] = useSetting<number>(
    MEMBER_LIST_WIDTH_KEY,
    DEFAULT_WIDTH,
  );
  const [dragging, setDragging] = useState<number | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const available = useParentWidth(asideRef);
  const width = clampWidth(dragging ?? stored, available);
  const listId = useId();

  return (
    <aside
      ref={asideRef}
      id={listId}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-border"
    >
      <MemberListResizer
        width={width}
        available={available}
        controls={listId}
        onChange={(next, final) => {
          if (final) {
            setDragging(null);
            setStored(next);
          } else setDragging(next);
        }}
      />
      <div className="border-b border-border px-4 py-3 text-sm font-semibold">
        Members ({members.length})
      </div>
      <TooltipProvider>
        <ul className="flex flex-col gap-0.5 overflow-auto p-2">
          {members.map((u) => {
            const presence = presenceFor?.(u.name);
            const meta = presence ? PRESENCE_META[presence] : null;
            const color = colorFor?.(u.name);
            const ignored = isIgnored?.(u.name) ?? false;
            const note = noteFor?.(u) ?? "";
            const mark = markFor?.(u.name) ?? null;
            const row = (
              <span
                className={cn(
                  "flex items-center gap-2",
                  ignored && "opacity-50",
                )}
              >
                {meta && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {/* Padded so the dot is not a 8px hover target. */}
                      <span className="-m-1 shrink-0 p-1">
                        <span
                          aria-hidden
                          className={cn(
                            "block size-2 rounded-full",
                            meta.dotClass,
                          )}
                        />
                        <span className="sr-only">{meta.label}</span>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{meta.label}</TooltipContent>
                  </Tooltip>
                )}
                {showSwatches &&
                  (color ? (
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/30"
                      style={{ backgroundColor: color }}
                    />
                  ) : (
                    <span aria-hidden className="size-2.5 shrink-0" />
                  ))}
                <span
                  className={cn(
                    "truncate",
                    mark && NAME_MARK_CLASS[mark],
                    mark === "you" && "font-medium",
                  )}
                  title={note ? `${u.name} - ${note}` : u.name}
                >
                  {u.name}
                </span>
                {mark && <NameMarkIcon mark={mark} />}
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <RankBadge rank={u.status.rank} />
                  <RatingBadge rating={u.rating} />
                  <CountryFlag country={u.country} />
                </span>
              </span>
            );
            return (
              <li key={u.name} className="flex items-center gap-1">
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(u.name)}
                    className="min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    {row}
                  </button>
                ) : (
                  <span className="block min-w-0 flex-1 px-2 py-1.5 text-sm">
                    {row}
                  </span>
                )}
                {renderActions?.(u)}
              </li>
            );
          })}
          {members.length === 0 && (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              No members.
            </li>
          )}
        </ul>
      </TooltipProvider>
    </aside>
  );
}
