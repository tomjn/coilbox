import { CheckCircle2, Lock, Trophy } from "lucide-react";
import { useMemo } from "react";
import {
  type AchievementCategory,
  type AchievementResult,
  evaluateAchievements,
} from "../../achievements";
import type { StatRecord } from "../../bindings";
import { playerGameFacts } from "../../stats";
import { TallyBar } from "./StatWidgets";

/** Category display order for the grouped achievements list. */
const CATEGORY_ORDER: AchievementCategory[] = [
  "Milestones",
  "Victories",
  "Streaks",
  "Variety",
  "Activity",
];

function earnedAt(ms: number | undefined): string | null {
  if (!ms) return null;
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** One achievement: earned/locked glyph, name, description, and a progress bar. */
function AchievementRow({ a }: { a: AchievementResult }) {
  const date = earnedAt(a.earnedAtMs);
  return (
    <li className="flex items-center gap-3 py-2">
      <span
        className={
          a.earned
            ? "shrink-0 text-primary"
            : "shrink-0 text-muted-foreground/60"
        }
      >
        {a.earned ? (
          <CheckCircle2 className="size-5" aria-label="Earned" />
        ) : (
          <Lock className="size-5" aria-label="Not yet earned" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`truncate text-sm font-medium ${
              a.earned ? "" : "text-muted-foreground"
            }`}
          >
            {a.name}
          </span>
          {date && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {date}
            </span>
          )}
        </div>
        <p
          className="truncate text-xs text-muted-foreground"
          title={a.description}
        >
          {a.description}
        </p>
      </div>
      {/* Cap the bar at the target so an over-achieved count still reads 100%. */}
      <TallyBar games={a.target} wins={Math.min(a.current, a.target)} />
    </li>
  );
}

/**
 * Offline achievements for one player (#461), derived live from the local stats
 * database - no separate persistence. Reuses the same genuine-match filter and
 * per-player history as every other stats aggregate (`playerGameFacts`), so a
 * remix/refight rerun can never earn one. Grouped by category, earned first
 * within each group. Rendered as a section on the Player stats page, so it
 * inherits that page's distribution-profile stats hiding (`multiplayer.stats`).
 */
export function AchievementsSection({
  records,
  playerName,
  refights,
}: {
  records: StatRecord[];
  playerName: string;
  refights: ReadonlySet<string>;
}) {
  const results = useMemo(
    () => evaluateAchievements(playerGameFacts(records, playerName, refights)),
    [records, playerName, refights],
  );

  const earnedCount = results.filter((r) => r.earned).length;

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        items: results
          .filter((r) => r.category === category)
          // Earned first, then by ascending target within the category.
          .sort(
            (a, b) =>
              Number(b.earned) - Number(a.earned) || a.target - b.target,
          ),
      })).filter((g) => g.items.length > 0),
    [results],
  );

  return (
    <section className="rounded-lg border border-border/60 bg-card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Trophy className="size-4 text-muted-foreground" />
        Achievements
        <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
          {earnedCount} of {results.length} earned
        </span>
      </h2>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map((g) => (
          <div key={g.category}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.category}
            </h3>
            <ul className="divide-y divide-border/40">
              {g.items.map((a) => (
                <AchievementRow key={a.id} a={a} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
