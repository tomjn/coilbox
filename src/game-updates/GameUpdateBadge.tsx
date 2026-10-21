import { plural, t } from "@lingui/core/macro";
import { Gamepad2 } from "lucide-react";
import { Link } from "react-router";
import { useGameUpdates } from "./GameUpdatesProvider";

/** The pill's text: the first thing with an update, and how many others. */
export function badgeLabel(names: readonly string[], count: number): string {
  const [first] = names;
  if (!first) return plural(count, { one: "# update", other: "# updates" });
  const others = count - 1;
  return count > 1 ? t`Update ${first} +${others}` : t`Update ${first}`;
}

/**
 * topbar.right slot: a pill naming what has a newer version, shown only when
 * there is at least one. The tooltip lists every one.
 */
export default function GameUpdateBadge() {
  const { updateCount, updateNames, updateTo } = useGameUpdates();
  if (updateCount === 0) return null;
  return (
    <Link
      to={updateTo}
      title={updateNames.join("\n") || undefined}
      className="flex max-w-64 items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
    >
      <Gamepad2 size={14} className="shrink-0" />
      <span className="truncate">{badgeLabel(updateNames, updateCount)}</span>
    </Link>
  );
}
