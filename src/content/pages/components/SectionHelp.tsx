import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  REPLAY_SOURCE_NOTES,
  REPLAY_SOURCES_DOC_URL,
  type ReplaySource,
} from "../../replaySources";

/**
 * The one help entry a section has: an icon button beside its heading that
 * opens a popover holding the section's explanation (#3889).
 *
 * Explanation, method and caveats go here and not under the controls. What
 * changes what the reader should do or believe right now (a warning that the
 * picture may be wrong, an empty state, a reason a control is off) stays in the
 * section. The popover opens on click, Enter and Space, closes on Escape and
 * hands focus back to the button, all of which Radix does for a popover.
 *
 * `source` puts the shared source line first, from `replaySources.ts`, and
 * `detail` adds a sentence the section knows. The link to the docs page that
 * explains the sources is always last.
 */
export function SectionHelp({
  section,
  source,
  detail,
  children,
}: {
  /** What the help is about, for the button's name: "About <section>". */
  section: string;
  source?: ReplaySource;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 text-muted-foreground"
          aria-label={`About ${section}`}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={`About ${section}`}
        className="flex max-h-[70vh] w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto p-3 text-xs"
      >
        {source && (
          <p className="text-muted-foreground">
            {REPLAY_SOURCE_NOTES[source]}
            {detail ? ` ${detail}` : ""}
          </p>
        )}
        {children}
        <button
          type="button"
          className="w-fit rounded-sm underline hover:no-underline focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => openUrl(REPLAY_SOURCES_DOC_URL).catch(() => {})}
        >
          Where these numbers come from
        </button>
      </PopoverContent>
    </Popover>
  );
}
