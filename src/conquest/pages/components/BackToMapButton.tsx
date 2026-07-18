import { ArrowLeft } from "lucide-react";

/**
 * A standalone "back to the map" arrow box, matching the map's top-left exit
 * control (a rounded card box beside the status cards) rather than a text link
 * buried in an overlay header. Mount it as its own element to the left — never
 * inside a panel/card — so it reads as a separate, obvious step-back target.
 * Pair it with the map's own click-empty-space-to-dismiss for the two natural
 * ways back. `className` positions it (e.g. `absolute left-4 top-4 z-10`).
 */
export function BackToMapButton({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to map"
      className={`pointer-events-auto flex items-center justify-center rounded-md border border-border/50 bg-card/70 p-3.5 text-muted-foreground backdrop-blur-sm transition-colors hover:border-border hover:text-foreground ${className}`}
    >
      <ArrowLeft className="size-5" aria-hidden />
    </button>
  );
}
