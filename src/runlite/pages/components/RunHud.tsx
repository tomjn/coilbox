import { t as coreT } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  CircuitBoard,
  Gauge,
  Heart,
  HelpCircle,
  Layers,
  Store,
  Wrench,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { clamp } from "@/lib/clamp";
import { DifficultyPips } from "@/play/pages/components/DifficultyPips";
import { toRoman } from "../../../conquest/names";
import {
  BracketFrame,
  HUD_DIM_INK_CLASS,
  HUD_INK_CLASS,
  type HudAccent,
  StatCard,
} from "../../../conquest/pages/components/hudChrome";
import type { RogueliteRun } from "../../model";

/** Difficulty tier -> flavour word for the trailing badge. */
function difficultyWord(difficulty: number): string {
  switch (difficulty) {
    case 1:
      return coreT`Recruit`;
    case 3:
      return coreT`Veteran`;
    case 4:
      return coreT`Elite`;
    case 5:
      return coreT`Nightmare`;
    default:
      return coreT`Standard`;
  }
}

/** Hull % -> a status word + accent, so health reads at a glance. */
function hullStatus(pct: number): { word: string; accent: HudAccent } {
  if (pct >= 75) return { word: coreT`Stable`, accent: "teal" };
  if (pct >= 40) return { word: coreT`Strained`, accent: "amber" };
  if (pct >= 15) return { word: coreT`Critical`, accent: "danger" };
  return { word: coreT`Failing`, accent: "danger" };
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
  /** Open the arsenal panel. Makes the Arsenal tile a button when given. */
  onInspectArsenal?: () => void;
}) {
  const { t } = useLingui();
  const p = run.progress;
  const maxCol = Math.max(...run.nodes.map((n) => n.col), 1);
  const depth = Math.max(
    ...run.nodes.filter((n) => p.visited.includes(n.id)).map((n) => n.col),
    0,
  );
  const hullPct = Math.round((p.hull / p.maxHull) * 100);
  const hull = hullStatus(hullPct);

  const unlocked = p.unlockedUnits.length;

  const difficulty = run.settings.difficulty;
  const ascension = run.settings.ascension;
  const sectorNumeral = toRoman(Math.max(1, depth));
  const diffWord = difficultyWord(difficulty);

  return (
    <div className="flex flex-wrap items-stretch gap-3">
      <StatCard
        grow={false}
        lead={
          logo ? (
            <span className="flex shrink-0 items-center justify-center text-foreground">
              <FactionLogo logo={logo} sideName={side} size={32} />
            </span>
          ) : undefined
        }
        icon={<Heart className="size-3.5 text-red-300" aria-hidden />}
        label={t`Hull`}
        meta={`${p.hull} / ${p.maxHull}`}
        value={hull.word}
        accent={hull.accent}
        action={
          <HelpDot
            label={t`Hull`}
            help={t`Your warpath ends when this reaches zero. Losing a battle costs hull — you retreat and press on — while events and depots can restore it.`}
          />
        }
      >
        <div className="mt-1.5 h-1.5 w-40 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${HULL_FILL[hull.accent]}`}
            style={{ width: `${clamp(hullPct, 0, 100)}%` }}
          />
        </div>
      </StatCard>

      <StatCard
        grow={false}
        icon={<Layers className="size-3.5 text-amber-400" aria-hidden />}
        label={t`Depth`}
        meta={`${depth} / ${maxCol}`}
        value={t`Sector ${sectorNumeral}`}
        accent="amber"
        action={
          <HelpDot
            label={t`Depth`}
            help={t`How far you've crossed the map. Reach and beat the warlord at the far end to win the warpath.`}
          />
        }
      >
        <div className="mt-1.5 flex w-40 items-center gap-1">
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
        grow={false}
        icon={<CircuitBoard className="size-3.5 text-yellow-300" aria-hidden />}
        label={t`Salvage`}
        labelInk="text-yellow-300"
        value={`${p.salvage}`}
        accent="neutral"
        action={
          <HelpDot
            label={t`Salvage`}
            help={t`Currency dropped by winning battles (more for elites and bosses). Spend it at depots on unit unlocks, perks, and repairs.`}
          />
        }
      >
        <p className="mt-1 font-display text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Trans>
            Spend at{" "}
            <span className="inline-flex items-center gap-1 align-middle text-emerald-300">
              <Store className="size-3" aria-hidden />
              depots
            </span>
          </Trans>
        </p>
      </StatCard>

      {onInspectArsenal ? (
        <BracketFrame className="flex-none p-0">
          <button
            type="button"
            onClick={onInspectArsenal}
            aria-label={t`Open arsenal`}
            className="pointer-events-auto block h-full cursor-pointer px-3 py-2 text-left transition-colors hover:bg-foreground/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span
              className={`flex items-center gap-1.5 font-display text-[10px] font-medium uppercase tracking-[0.18em] ${HUD_DIM_INK_CLASS}`}
            >
              <Wrench className="size-3.5" aria-hidden />
              <Trans>Arsenal</Trans>
            </span>
            <span
              className={`mt-1 block font-display text-xl font-semibold leading-none tracking-wide tabular-nums ${HUD_INK_CLASS}`}
            >
              {arsenalTotal ? `${unlocked} / ${arsenalTotal}` : `${unlocked}`}
            </span>
          </button>
        </BracketFrame>
      ) : (
        <StatCard
          grow={false}
          icon={
            <Wrench className="size-3.5 text-muted-foreground" aria-hidden />
          }
          label={t`Arsenal`}
          value={arsenalTotal ? `${unlocked} / ${arsenalTotal}` : `${unlocked}`}
          accent="neutral"
        />
      )}

      <StatCard
        grow={false}
        icon={<Gauge className="size-3.5 text-amber-400" aria-hidden />}
        label={t`Difficulty`}
        meta={ascension > 0 ? `A${ascension}` : undefined}
        value={diffWord}
        accent="amber"
      >
        <div className="mt-1.5">
          <DifficultyPips filled={difficulty} />
        </div>
      </StatCard>
    </div>
  );
}

/** A subtle top-right help affordance for a stat tile. */
function HelpDot({ label, help }: { label: string; help: string }) {
  const { t } = useLingui();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t`What is ${label}?`}
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
