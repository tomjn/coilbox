import {
  Heart,
  HelpCircle,
  Layers,
  ListTree,
  Sparkles,
  Wrench,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { clamp } from "@/lib/helpers";
import { toRoman } from "../../../conquest/names";
import {
  BracketFrame,
  HUD_ACCENT_INK,
  type HudAccent,
  MAP_BAND_CLASS,
  StatCard,
} from "../../../conquest/pages/components/hudChrome";
import type { RogueliteRun } from "../../model";

/** Difficulty tier -> flavour word for the trailing badge. */
const DIFFICULTY_WORD = [
  "Standard",
  "Recruit",
  "Standard",
  "Veteran",
  "Elite",
  "Nightmare",
];

/** Hull % -> a status word + accent, so health reads at a glance. */
function hullStatus(pct: number): { word: string; accent: HudAccent } {
  if (pct >= 75) return { word: "Stable", accent: "teal" };
  if (pct >= 40) return { word: "Strained", accent: "amber" };
  if (pct >= 15) return { word: "Critical", accent: "danger" };
  return { word: "Failing", accent: "danger" };
}

/**
 * The bar under the hull figure. It repeats what the tile already says in words
 * and in its `n / max` meta, so it is decoration rather than the only reading of
 * the number, but a decoration nobody can see is not doing its job.
 *
 * `bg-red-500` was the one that vanished: measured over the HUD card with a
 * white star behind it, 1.94:1 (#1801). Red has little luminance to spend, so
 * the danger step is a pale one, the same conclusion `HUD_ACCENT_INK` reached
 * for the word above it.
 */
const HULL_FILL: Record<HudAccent, string> = {
  teal: "bg-cyan-400",
  amber: "bg-amber-400",
  danger: "bg-red-300",
  neutral: "bg-foreground",
};

/**
 * Top HUD: health, depth, salvage, and the shared arsenal ceiling, rendered as
 * framed "command console" tiles (see {@link StatCard}). Each stat pairs a
 * tracked-allcaps label + raw figures with a large display value derived from
 * those figures (a status word, sector numeral, tech tier), plus a help popover.
 */
export function RunHud({
  run,
  arsenalTotal,
  logo,
  side,
  onInspectArsenal,
}: {
  run: RogueliteRun;
  arsenalTotal?: number;
  /** The run's chosen faction emblem, shown as a leading tile when resolved. */
  logo?: FactionLogoSrc;
  side?: string;
  /** Open the read-only arsenal tech-tree. Adds an inspect control when given. */
  onInspectArsenal?: () => void;
}) {
  const p = run.progress;
  const maxCol = Math.max(...run.nodes.map((n) => n.col), 1);
  const depth = Math.max(
    ...run.nodes.filter((n) => p.visited.includes(n.id)).map((n) => n.col),
    0,
  );
  const hullPct = Math.round((p.hull / p.maxHull) * 100);
  const hull = hullStatus(hullPct);

  const unlocked = p.unlockedUnits.length;
  const tier = arsenalTotal
    ? clamp(Math.ceil((unlocked / arsenalTotal) * 5), 1, 5)
    : null;

  const difficulty = run.settings.difficulty;
  const ascension = run.settings.ascension;
  const diffWord = DIFFICULTY_WORD[difficulty] ?? "Standard";

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      {logo && (
        <BracketFrame className="flex min-w-[4rem] items-center justify-center px-3 py-2 text-foreground">
          <FactionLogo logo={logo} sideName={side} size={32} />
        </BracketFrame>
      )}

      <StatCard
        icon={<Heart className="size-3.5 text-cyan-400" aria-hidden />}
        label="Hull"
        meta={`${p.hull} / ${p.maxHull}`}
        value={hull.word}
        accent={hull.accent}
        action={
          <HelpDot
            label="Hull"
            help="Your warpath ends when this reaches zero. Losing a battle costs hull — you retreat and press on — while events and depots can restore it."
          />
        }
      >
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${HULL_FILL[hull.accent]}`}
            style={{ width: `${clamp(hullPct, 0, 100)}%` }}
          />
        </div>
      </StatCard>

      <StatCard
        icon={<Layers className="size-3.5 text-amber-400" aria-hidden />}
        label="Depth"
        meta={`${depth} / ${maxCol}`}
        value={`Sector ${toRoman(Math.max(1, depth))}`}
        accent="amber"
        action={
          <HelpDot
            label="Depth"
            help="How far you've crossed the map. Reach and beat the warlord at the far end to win the warpath."
          />
        }
      >
        <div className="mt-1.5 flex items-center gap-1">
          {Array.from({ length: maxCol }, (_, i) => {
            const col = i + 1;
            const state =
              col === depth
                ? "bg-amber-300"
                : col < depth
                  ? "bg-amber-400"
                  : "bg-muted";
            return (
              <span key={col} className={`h-1.5 flex-1 rounded-sm ${state}`} />
            );
          })}
        </div>
      </StatCard>

      <StatCard
        icon={<Sparkles className="size-3.5 text-yellow-300" aria-hidden />}
        label="Salvage"
        value={`${p.salvage}`}
        accent="neutral"
        action={
          <HelpDot
            label="Salvage"
            help="Currency dropped by winning battles (more for elites and bosses). Spend it at depots on unit unlocks, perks, and repairs."
          />
        }
      >
        <p className="mt-1 font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Spend at depots
        </p>
      </StatCard>

      <StatCard
        icon={<Wrench className="size-3.5 text-muted-foreground" aria-hidden />}
        label="Arsenal"
        meta={arsenalTotal ? `${unlocked} / ${arsenalTotal}` : undefined}
        value={tier ? `Tech ${toRoman(tier)}` : `${unlocked}`}
        accent="neutral"
        action={
          <div className="flex items-center gap-1">
            {onInspectArsenal && (
              <button
                type="button"
                onClick={onInspectArsenal}
                aria-label="View the arsenal tech tree"
                title="View arsenal tree"
                className="pointer-events-auto -m-1 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ListTree className="size-3" aria-hidden />
              </button>
            )}
            <HelpDot
              label="Arsenal"
              help="The units you can currently build, out of your faction's full tree. Rewards and depots unlock more, but unlocking raises a shared tech ceiling, so the enemy escalates with you. Your personal edge comes from perks, not unlocks."
            />
          </div>
        }
      >
        <p className="mt-1 font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Shared ceiling
        </p>
      </StatCard>

      <div className="flex items-center">
        {/* The one thing in this row that is not a framed tile, so it is the one
            thing with the node map straight behind it. Its amber measured
            1.0:1 there, since ink and canvas can be the same colour, and the
            band is the answer the conquest map's loose labels already take
            (#1052, #1801). */}
        <span
          className={`${MAP_BAND_CLASS} border border-dashed border-amber-400/80 px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.2em] ${HUD_ACCENT_INK.amber}`}
        >
          {diffWord}
          {ascension > 0 && <span className="ml-1">A{ascension}</span>}
        </span>
      </div>
    </div>
  );
}

/** A subtle top-right help affordance for a stat tile. */
function HelpDot({ label, help }: { label: string; help: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What is ${label}?`}
          className="pointer-events-auto -m-1 flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <HelpCircle className="size-3" aria-hidden />
        </button>
      </PopoverTrigger>
      {/* Radix portals this to the body. That used to put it outside the map's
          forced-dark subtree, a white card hanging off a dark HUD tile, so it
          carried the forcing itself. The route declares its appearance now, so
          the whole window is dark while the map is open and anything portalled
          out of it lands somewhere dark too. */}
      <PopoverContent className="w-64 text-xs leading-relaxed text-muted-foreground">
        <p className="mb-1 font-display font-semibold uppercase tracking-wider text-foreground">
          {label}
        </p>
        {help}
      </PopoverContent>
    </Popover>
  );
}
