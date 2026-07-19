import { Heart, HelpCircle, Layers, Sparkles, Wrench } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import type { RogueliteRun } from "../../model";

/** Top HUD: health, depth, salvage, and the shared arsenal ceiling, each with a
 * clickable help popover explaining the stat. */
export function RunHud({
  run,
  arsenalTotal,
  logo,
  side,
}: {
  run: RogueliteRun;
  arsenalTotal?: number;
  /** The run's chosen faction emblem, shown as a leading tile when resolved. */
  logo?: FactionLogoSrc;
  side?: string;
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
      {logo && (
        <div className="flex min-w-[4rem] items-center justify-center rounded-md border border-border/50 bg-card/70 px-3 py-2 text-foreground">
          <FactionLogo logo={logo} sideName={side} size={32} />
        </div>
      )}
      <Gauge
        icon={<Heart className="size-4 text-cyan-400" aria-hidden />}
        label="Health"
        value={`${p.hull} / ${p.maxHull}`}
        help="Your warpath ends when this reaches zero. Losing a battle costs health — you retreat and press on — while events and depots can restore it."
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
        help="How far you've crossed the map. Reach and beat the warlord at the far end to win the warpath."
      />
      <Gauge
        icon={<Sparkles className="size-4 text-yellow-300" aria-hidden />}
        label="Salvage"
        value={`${p.salvage}`}
        help="Currency dropped by winning battles (more for elites and bosses). Spend it at depots on unit unlocks, perks, and repairs."
      />
      <Gauge
        icon={<Wrench className="size-4 text-muted-foreground" aria-hidden />}
        label="Arsenal"
        value={
          arsenalTotal
            ? `${p.unlockedUnits.length} / ${arsenalTotal}`
            : `${p.unlockedUnits.length}`
        }
        help="The units you can currently build, out of your faction's full tree. Rewards and depots unlock more — but unlocking raises a shared tech ceiling, so the enemy escalates with you. Your personal edge comes from perks, not unlocks."
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
  help,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  help: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-w-[8rem] flex-1 rounded-md border border-border/50 bg-card/70 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`What is ${label}?`}
              className="pointer-events-auto -m-1 flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <HelpCircle className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-semibold uppercase tracking-wider text-foreground">
              {label}
            </p>
            {help}
          </PopoverContent>
        </Popover>
      </div>
      <div className="mt-0.5 font-semibold tabular-nums">{value}</div>
      {children}
    </div>
  );
}
