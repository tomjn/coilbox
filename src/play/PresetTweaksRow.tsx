import { ChevronRight, Wrench } from "lucide-react";

/**
 * The way into unit tweaks from a preset sheet, sitting above the preset list.
 *
 * A row rather than a button, so it reads as another thing the sheet can show
 * you rather than an action it performs, which is what it is: it opens a list.
 */
export function PresetTweaksRow({
  disabled,
  unavailable,
  onOpen,
}: {
  disabled?: boolean;
  /** Why there is nothing behind this row, which makes it unopenable and is
   *  said in place of the usual subtitle. */
  unavailable?: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled || !!unavailable}
      className="mb-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Wrench className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">Unit tweaks</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {unavailable ?? "Apply a project over the options"}
        </span>
      </span>
      {!unavailable && (
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      )}
    </button>
  );
}
