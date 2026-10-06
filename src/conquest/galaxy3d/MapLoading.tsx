import { cn } from "@picoframe/frame";
import { Loader2 } from "lucide-react";

/** Fills the strategic view's place while its map is not ready to draw. */
export function MapLoading({
  label,
  className,
}: {
  /** What is being waited on, said to the player. */
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex h-full flex-col items-center justify-center gap-3 bg-[#05070f] text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="size-6 motion-safe:animate-spin" aria-hidden />
      {label}
    </div>
  );
}
