import { cn } from "@picoframe/frame";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { useStillUi } from "../../../general/display";

/**
 * The card every mission briefing phase is drawn in, over the panorama.
 *
 * It lives here rather than in `MissionBriefingPage` so a card can be rendered
 * on its own in a test: that page pulls in the 3D map and unit previews, which
 * take seconds to import.
 */
export function PhaseCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  // Cross-fade between phases, and the Victory/Defeat stamp passed in via
  // className. Dropped entirely when the user prefers a still UI.
  const still = useStillUi();
  return (
    <Card
      className={cn(
        "w-full max-w-md gap-4 border-border/50 bg-card/85 p-5 shadow-none backdrop-blur-sm",
        !still && "phase-fade",
        !still && className,
      )}
    >
      {children}
    </Card>
  );
}
