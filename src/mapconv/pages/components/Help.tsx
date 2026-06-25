import { ExternalLink, HelpCircle } from "lucide-react";
import type { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { mcOpenUrl } from "../../bindings";

/**
 * Spring mapping wiki pages, by topic. The per-input pages explain each source
 * map far better than a field hint can. Opened in the OS browser (the in-app
 * webview can't render them, and they're behind anti-bot protection anyway).
 */
export const WIKI = {
  main: "https://springrts.com/wiki/Mapdev:Main",
  tutorial: "https://springrts.com/wiki/Mapdev:Tutorial_Simple",
  sizes: "https://springrts.com/wiki/MapSizes",
  diffuse: "https://springrts.com/wiki/Mapdev:diffuse",
  height: "https://springrts.com/wiki/Mapdev:height",
  metal: "https://springrts.com/wiki/Mapdev:metal",
  terraintype: "https://springrts.com/wiki/Mapdev:terraintype",
  grass: "https://springrts.com/wiki/Mapdev:grass",
  features: "https://springrts.com/wiki/Mapdev:features",
  minimap: "https://springrts.com/wiki/Mapdev:minimap",
} as const;

/** Open an external URL in the OS default browser. */
export function openExternal(url: string) {
  mcOpenUrl({ url }).catch(() => {});
}

/** A small "?" icon that reveals explanatory help on hover/focus. */
export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // Stop the wrapping <label> from forwarding the click to its control.
            onClick={(e) => e.preventDefault()}
            aria-label="Help"
            className="cursor-help text-muted-foreground transition-colors hover:text-foreground"
          >
            <HelpCircle size={13} />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-left leading-snug">
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A "Learn more" link that opens a wiki page in the OS browser. */
export function LearnMore({
  href,
  label = "Learn more",
}: {
  href: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        openExternal(href);
      }}
      className="inline-flex cursor-pointer items-center gap-0.5 text-xs text-primary hover:underline"
    >
      {label} <ExternalLink size={11} />
    </button>
  );
}
