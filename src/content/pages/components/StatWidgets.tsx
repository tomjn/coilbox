/** Small stat-display building blocks shared by the Stats page (#414) and the
 * player dossier (#375) — both project the same local stats database. */

/** A single headline stat tile. */
export function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** A win-rate bar plus its "wins/games · rate%" label, with no wrapper element
 * so callers can place it inside their own row (see `TallyRow`, and the game
 * detail page's per-faction records, #460). */
export function TallyBar({ games, wins }: { games: number; wins: number }) {
  const rate = games > 0 ? wins / games : 0;
  return (
    <>
      <div className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70"
          style={{ width: `${Math.round(rate * 100)}%` }}
        />
      </div>
      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {wins}/{games} · {Math.round(rate * 100)}%
      </span>
    </>
  );
}

/** A win/loss tally row (map or faction), with a win-rate bar. */
export function TallyRow({
  label,
  games,
  wins,
}: {
  label: string;
  games: number;
  wins: number;
}) {
  return (
    <li className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-sm" title={label}>
        {label}
      </span>
      <TallyBar games={games} wins={wins} />
    </li>
  );
}
