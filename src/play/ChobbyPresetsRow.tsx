import { useLingui } from "@lingui/react/macro";
import { ChevronRight, FileJson } from "lucide-react";

/**
 * The way into BYAR-Chobby's saved presets from a preset sheet, sitting above
 * the preset list. Only rendered when a data folder holds Chobby's file, so a
 * player without Chobby never sees it.
 */
export function ChobbyPresetsRow({
  disabled,
  onOpen,
}: {
  disabled?: boolean;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      className="mb-3 flex w-full min-w-0 items-center gap-3 rounded-lg border border-border/50 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
    >
      <FileJson className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          {t`Chobby presets`}
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {t`Import from or write to optionsPresets.json`}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
