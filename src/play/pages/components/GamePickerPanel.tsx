import { Button } from "@picoframe/frame";
import { ChevronLeft } from "lucide-react";
import type { GameItem } from "@/content/bindings";
import { GamePickerGrid } from "./GamePickerGrid";

/**
 * The game picker as a drawer's whole content, with a back button, for a form
 * that is already showing in a drawer. The form swaps this in rather than
 * opening a second drawer on top of its own, the way the host forms pick a map
 * (issue #2796). Picking a game, or going back, returns to the form.
 */
export function GamePickerPanel({
  games,
  headers,
  selectedName,
  onSelect,
  onBack,
  backLabel,
  gamesLoading,
}: {
  games: readonly GameItem[];
  headers: Map<string, string>;
  selectedName: string;
  onSelect: (name: string) => void;
  onBack: () => void;
  /** What the back button returns to, for its accessible name. */
  backLabel: string;
  gamesLoading?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <h2 className="text-sm font-semibold">Choose a game</h2>
      </div>
      <GamePickerGrid
        games={games}
        headers={headers}
        selectedName={selectedName}
        onSelect={(name) => {
          onSelect(name);
          onBack();
        }}
        gamesLoading={gamesLoading}
      />
    </div>
  );
}
