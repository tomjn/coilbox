import { ImageOff } from "lucide-react";
import { useState } from "react";
import type { GameItem } from "@/content/bindings";
import { useBrandingEntry, useBrandingImage } from "@/content/branding";
import { GamePickerDrawer } from "./GamePickerDrawer";

/**
 * A form field's game control: the chosen game's art and name on a button that
 * opens the searchable picker (issue #2995). The game counterpart of the map
 * button in the host forms, and styled to match it. What pressing it does is
 * the caller's: a form inside a drawer swaps in `GamePickerPanel`, and one on a
 * page uses {@link GamePickerField} to open `GamePickerDrawer`.
 */
export function GamePickerButton({
  value,
  games,
  headers,
  placeholder,
  ariaLabel,
  disabled,
  onClick,
}: {
  value: string;
  games: readonly GameItem[];
  headers: Map<string, string>;
  /** Shown when no game is chosen. */
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  const game = games.find((g) => g.name === value);
  const brand = useBrandingEntry(game);
  const brandBanner = useBrandingImage(brand?.banner, true);
  const art = game ? (brandBanner ?? headers.get(game.name)) : undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex h-11 w-full items-center gap-2 rounded-md border border-input bg-transparent px-2 text-left text-sm shadow-xs transition-colors hover:bg-accent/50 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
    >
      <span className="flex h-8 w-14 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
        {art ? (
          <img src={art} alt="" className="size-full object-cover" />
        ) : (
          <ImageOff className="size-4 text-muted-foreground" />
        )}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${value ? "" : "text-muted-foreground"}`}
      >
        {value || placeholder}
      </span>
    </button>
  );
}

/**
 * {@link GamePickerButton} with its own `GamePickerDrawer`, for a form that sits
 * on a page or in a popover. A form already inside a drawer should swap in
 * `GamePickerPanel` instead, rather than stack a second drawer (issue #2796).
 */
export function GamePickerField({
  value,
  onValueChange,
  games,
  headers,
  placeholder,
  ariaLabel,
  disabled,
  gamesLoading,
}: {
  value: string;
  onValueChange: (name: string) => void;
  games: readonly GameItem[];
  headers: Map<string, string>;
  placeholder: string;
  ariaLabel?: string;
  disabled?: boolean;
  gamesLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GamePickerButton
        value={value}
        games={games}
        headers={headers}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
      <GamePickerDrawer
        open={open}
        onOpenChange={setOpen}
        games={games}
        headers={headers}
        selectedName={value}
        onSelect={onValueChange}
        gamesLoading={gamesLoading}
      />
    </>
  );
}
