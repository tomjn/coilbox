import { Button } from "@picoframe/frame";
import { Gift, Sparkles, Store } from "lucide-react";
import type { RewardOption, RogueliteRun, RunNode } from "../../model";
import {
  applyEvent,
  applyReward,
  buyOffer,
  leaveNode,
  restAtShop,
} from "../../progress";

type Apply = (next: RogueliteRun) => void | Promise<void>;

/** Shared overlay chrome. Clicking the backdrop dismisses it. */
function Overlay({
  icon,
  title,
  lede,
  onClose,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  lede?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 p-4 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Back to map"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative flex w-[42rem] max-w-full flex-col gap-4 rounded-lg border border-border/50 bg-card/90 p-6">
        <header className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            {icon}
            {title}
          </h1>
          {lede && <p className="text-sm text-muted-foreground">{lede}</p>}
        </header>
        {children}
      </div>
    </div>
  );
}

function optionText(o: RewardOption): {
  name: string;
  desc: string;
  tag: string;
} {
  if (o.kind === "unlock") {
    return {
      name: o.unitName,
      desc: `Unlocks ${o.opens.length + 1} unit${o.opens.length ? "s" : ""} along the build tree.`,
      tag: "raises tech ceiling · both sides",
    };
  }
  const pct = Math.round(o.perk.value * 100);
  return {
    name: o.perk.label,
    desc:
      o.perk.kind === "advantage"
        ? `+${pct}% resource advantage for your commander.`
        : `+${pct}% income for your commander.`,
    tag: "you only · per-team",
  };
}

export function RewardOverlay({
  run,
  node,
  onApply,
  onClose,
}: {
  run: RogueliteRun;
  node: RunNode;
  onApply: Apply;
  onClose: () => void;
}) {
  const options = node.reward?.options ?? [];
  const take = async (i: number) => {
    await onApply(applyReward(run, node.id, i));
    onClose();
  };
  const skip = async () => {
    await onApply(leaveNode(run, node.id));
    onClose();
  };
  return (
    <Overlay
      icon={<Gift className="size-5 text-yellow-300" aria-hidden />}
      title={node.reward?.title ?? "Salvage cache"}
      lede="Take a schematic to widen the arsenal, or a field upgrade for your command alone."
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {options.map((o, i) => {
          const t = optionText(o);
          const key = o.kind === "unlock" ? `u-${o.unit}` : `p-${o.perk.label}`;
          return (
            <button
              key={key}
              type="button"
              onClick={() => take(i)}
              className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 p-4 text-left transition-colors hover:border-primary"
            >
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {o.kind === "unlock" ? "Schematic" : "Field upgrade"}
              </span>
              <span className="font-semibold">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.desc}</span>
              <span className="mt-auto text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {t.tag}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={skip}
        className="self-center text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Leave it — bank the run
      </button>
    </Overlay>
  );
}

export function EventOverlay({
  run,
  node,
  onApply,
  onClose,
}: {
  run: RogueliteRun;
  node: RunNode;
  onApply: Apply;
  onClose: () => void;
}) {
  const ev = node.event;
  const choose = async (i: number) => {
    await onApply(applyEvent(run, node.id, i));
    onClose();
  };
  return (
    <Overlay
      icon={<Sparkles className="size-5 text-violet-400" aria-hidden />}
      title={ev?.title ?? "Signal"}
      lede={ev?.body}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        {(ev?.choices ?? []).map((c, i) => (
          <button
            key={`${c.label}-${c.detail ?? ""}`}
            type="button"
            onClick={() => choose(i)}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3 text-left transition-colors hover:border-primary"
          >
            <span className="font-medium">{c.label}</span>
            {c.detail && (
              <span className="text-xs text-muted-foreground">{c.detail}</span>
            )}
          </button>
        ))}
      </div>
    </Overlay>
  );
}

export function ShopOverlay({
  run,
  node,
  onApply,
  onClose,
}: {
  run: RogueliteRun;
  node: RunNode;
  onApply: Apply;
  onClose: () => void;
}) {
  const shop = node.shop;
  const salvage = run.progress.salvage;
  const buy = (i: number) => onApply(buyOffer(run, node.id, i));
  const rest = () => onApply(restAtShop(run, node.id));
  const leave = async () => {
    await onApply(leaveNode(run, node.id));
    onClose();
  };
  const canRest =
    !!shop?.restHull &&
    run.progress.hull < run.progress.maxHull &&
    salvage >= (shop.restCost ?? 0);
  return (
    <Overlay
      icon={<Store className="size-5 text-emerald-400" aria-hidden />}
      title="Salvage depot"
      lede={`Salvage: ${salvage}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-2">
        {(shop?.offers ?? []).map((offer, i) => {
          const t = optionText(offer.option);
          const affordable = salvage >= offer.cost;
          const key =
            offer.option.kind === "unlock"
              ? `u-${offer.option.unit}-${offer.cost}`
              : `p-${offer.option.perk.label}-${offer.cost}`;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/30 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.desc}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!affordable}
                onClick={() => buy(i)}
              >
                {offer.cost} salvage
              </Button>
            </div>
          );
        })}
        {shop?.restHull != null && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border/60 px-4 py-3">
            <div>
              <div className="font-medium">Rest &amp; repair</div>
              <div className="text-xs text-muted-foreground">
                +{shop.restHull} hull
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!canRest}
              onClick={rest}
            >
              {shop.restCost ?? 0} salvage
            </Button>
          </div>
        )}
      </div>
      <Button className="self-center" variant="ghost" onClick={leave}>
        Leave the depot
      </Button>
    </Overlay>
  );
}
