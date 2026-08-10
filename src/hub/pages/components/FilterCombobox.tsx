import { Input } from "@picoframe/frame";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

/**
 * A text filter with a suggestion list under it, for the hub filters (issue
 * #1357) that have no server-side facet to draw a dropdown from: game and map.
 * The hub offers no list of the values it carries, so the suggestions are built
 * from what coilbox knows is installed locally instead - which is also more
 * useful to a player than every value the gallery has ever seen.
 *
 * A locally installed name will not always match what the hub stores. Typing is
 * always what gets sent, and the list is a shortcut into it, never the only way
 * in. Picking a suggestion commits immediately, typing commits on blur or Enter.
 *
 * The box is an anchor rather than a trigger, because it is a text field first
 * and the list follows what is typed in it. That means Radix counts a press on
 * the box itself as a press outside the list: focus opens the list and the same
 * press closes it again, which read as a flicker rather than as a dropdown. So
 * a press that started inside the anchor is not an outside press, and the list
 * stays up. Everything that should close it still does.
 */
export function FilterCombobox({
  value,
  onCommit,
  options,
  placeholder,
  ariaLabel,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  options: string[];
  placeholder: string;
  ariaLabel: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);

  // Stay in sync when the filter changes from elsewhere - a card's game/map
  // badge, or the chip's own "X", both of which set the filter directly.
  useEffect(() => setDraft(value), [value]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const list = q
      ? options.filter((o) => o.toLowerCase().includes(q))
      : options;
    return list.slice(0, 50);
  }, [options, draft]);

  function commit(next: string) {
    setDraft(next);
    setOpen(false);
    if (next.trim() !== value.trim()) onCommit(next);
  }

  return (
    <Popover open={open && options.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor ref={anchor}>
        <Input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              commit(draft);
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className={className}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-64 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          if (anchor.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        <ul className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {matches.map((o) => (
            <li key={o}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(o)}
                className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {o}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-xs text-muted-foreground">
              No installed match for &quot;{draft}&quot;.
            </li>
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
