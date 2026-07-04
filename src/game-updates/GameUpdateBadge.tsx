import { Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { useGameUpdates } from "./GameUpdatesProvider";

/**
 * topbar.right slot: a "Game update" pill, shown only when the profile's release
 * repo has a newer game archive than the one installed.
 */
export default function GameUpdateBadge() {
  const { updateAvailable } = useGameUpdates();
  if (!updateAvailable) return null;
  return (
    <Link
      to="/settings/game-updates"
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Gamepad2 size={14} />
      Game update
    </Link>
  );
}
