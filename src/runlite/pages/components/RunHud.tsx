import { Heart, Layers, Sparkles, Wrench } from "lucide-react";
import type { RogueliteRun } from "../../model";

/** Top HUD: hull, depth, salvage, and the shared arsenal ceiling. Mirrors the
 * gauges in docs/mockups/roguelite-run.html, on the app's own tokens. */
export function RunHud({
  run,
  arsenalTotal,
}: {
  run: RogueliteRun;
  arsenalTotal?: number;
}) {
  const p = run.progress;
  const maxCol = Math.max(...run.nodes.map((n) => n.col), 1);
  const depth = Math.max(
    ...run.nodes.filter((n) => p.visited.includes(n.id)).map((n) => n.col),
    0,
  );
  const hullPct = Math.round((p.hull / p.maxHull) * 100);
  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <Gauge
        icon={<Heart className="size-4 text-cyan-400" aria-hidden />}
        label="Health"
        value={`${p.hull} / ${p.maxHull}`}
      >
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all"
            style={{ width: `${hullPct}%` }}
          />
        </div>
      </Gauge>
      <Gauge
        icon={<Layers className="size-4 text-amber-400" aria-hidden />}
        label="Depth"
        value={`${depth} / ${maxCol}`}
      />
      <Gauge
        icon={<Sparkles className="size-4 text-yellow-300" aria-hidden />}
        label="Salvage"
        value={`${p.salvage}`}
      />
      <Gauge
        icon={<Wrench className="size-4 text-muted-foreground" aria-hidden />}
        label="Arsenal"
        value={
          arsenalTotal
            ? `${p.unlockedUnits.length} / ${arsenalTotal}`
            : `${p.unlockedUnits.length}`
        }
      >
        <p className="mt-1 text-[10px] text-muted-foreground">shared ceiling</p>
      </Gauge>
    </div>
  );
}

function Gauge({
  icon,
  label,
  value,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-[8rem] flex-1 rounded-md border border-border/50 bg-card/70 px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
      </div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
      {children}
    </div>
  );
}
