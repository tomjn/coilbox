import { useEffect, useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  describeOutput,
  markLabel,
  markPercent,
  scrubberMarks,
} from "../../scriptMarks";
import type { ScriptOutput } from "../../scriptPlayback";

/**
 * One mark under the scrubber for each frame the script announced something
 * on: an effect, an explosion, a sound, or carrying the stand-in. Each is a
 * button that seeks to its frame, and its tooltip lists what happened there.
 *
 * Measured, so that frames too close to tell apart on screen share a mark.
 */
export function ScrubberMarks({
  events,
  frameCount,
  onSeek,
}: {
  events: ScriptOutput[];
  frameCount: number;
  onSeek: (frame: number) => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = row.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const marks = scrubberMarks(events, frameCount, width);
  return (
    <TooltipProvider>
      <div
        ref={row}
        role="group"
        aria-label="What the script announced"
        className="relative h-6"
      >
        {marks.map((mark) => (
          <Tooltip key={mark.frame}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={markLabel(mark)}
                onClick={() => onSeek(mark.frame)}
                className="absolute top-0 flex size-6 -translate-x-1/2 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ left: `${markPercent(mark.frame, frameCount)}%` }}
              >
                <span className="block h-3 w-0.5 rounded-full bg-primary" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <ul className="flex flex-col gap-0.5 text-xs">
                {mark.events.map((event, index) => (
                  <li key={`${event.frame}-${index}`}>
                    Frame {event.frame + 1}: {describeOutput(event)}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
