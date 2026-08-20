import { ArrowLeft } from "lucide-react";
import { HUD_CARD_CLASS } from "./hudChrome";

/**
 * A standalone "back to the map" arrow box, matching the map's top-left exit
 * control (a rounded card box beside the status cards) rather than a text link
 * buried in an overlay header. Mount it as its own element to the left — never
 * inside a panel/card — so it reads as a separate, obvious step-back target.
 * Pair it with the map's own click-empty-space-to-dismiss for the two natural
 * ways back. `className` positions it (e.g. `absolute left-4 top-4 z-10`).
 *
 * The box is {@link HUD_CARD_CLASS} rather than the `bg-card/70` it was written
 * as, for the reason that class documents: at 70% a third of the starfield lands
 * behind the arrow, and `text-muted-foreground` on that measured 2.3:1 (#1812).
 * `backdrop-blur-sm` does not rescue it, because blurring a white star leaves a
 * white average. The class also points `--muted-foreground` at the card's own
 * ink for the subtree, so the arrow is bounded without naming a colour here.
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
      className={`pointer-events-auto flex items-center justify-center p-3.5 text-muted-foreground backdrop-blur-sm transition-colors hover:border-border hover:text-foreground ${HUD_CARD_CLASS} ${className}`}
    >
      <ArrowLeft className="size-5" aria-hidden />
    </button>
  );
}
