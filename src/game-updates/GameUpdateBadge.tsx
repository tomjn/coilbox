import { Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { useGameUpdates } from "./GameUpdatesProvider";

/**
 * topbar.right slot: a pill with the count of games and engines that have a
 * newer version, shown only when there is at least one.
 */
export default function GameUpdateBadge() {
  const { updateCount, updateTo } = useGameUpdates();
  if (updateCount === 0) return null;
  return (
    <Link
      to={updateTo}
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Gamepad2 size={14} />
      {updateCount === 1 ? "1 update" : `${updateCount} updates`}
    </Link>
  );
}
