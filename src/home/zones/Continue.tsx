import { buttonVariants, cn } from "@picoframe/frame";
import type { LucideIcon } from "lucide-react";
import { Gamepad2, Milestone, Orbit, Play, Rocket, Swords } from "lucide-react";
import { Link } from "react-router";
import { RESUME_KIND_COPY, type ResumeKind, useResume } from "../continue";

/**
 * The icon for each kind, matching the sidebar item that kind lives under.
 *
 * Presentation rather than copy, so it stays in the zone while the wording stays
 * in the collector. Hardcoded rather than read off the nav, because a profile can
 * hide a nav item (`useVisible`) and the card still has to draw something.
 */
const KIND_ICON: Record<ResumeKind, LucideIcon> = {
  battle: Gamepad2,
  warpath: Rocket,
  conquest: Orbit,
  campaign: Milestone,
  skirmish: Swords,
};

/**
 * One large card for the single most relevant thing to pick up again, with the
 * action that goes straight back to it.
 *
 * Renders nothing when there is nothing to resume. On a fresh install the
 * Onboarding zone owns the one call to action, and a second competing one would
 * make the page ask twice.
 *
 * It also renders nothing while the sources are still loading, so the hero never
 * shows the best of a half-read set and then swaps to a different card once the
 * rest answers. The resume rail (#994) waits on the same flag, so the two appear
 * together rather than the rail filling in under a settled hero.
 *
 * ## No art
 *
 * The card carries an icon, not artwork. `resolveCardArt` is keyed by tool id and
 * a resume candidate is a run, a mission or a battle, so the only key this zone
 * could pass is the tool the kind lives under. That would paint the Warpath
 * tool's art here and the same art again on the tool card lower down the same
 * page, and it would say nothing about *this* run. The art that would mean
 * something, the run's own galaxy or the mission's panorama, is the content step
 * of the chain (#989) and is keyed by tool as well, so it cannot answer "this
 * one". Inventing a second art path is exactly what the design forbids, so the
 * hero renders in the icon-only mode the chain already supports and earns its
 * weight from size, the accent border and a plain action.
 *
 * Layout-agnostic: no page-level spacing or width of its own, because the
 * `stacked` layout is a compatibility contract and a later layout has to be able
 * to put this card somewhere else.
 */
export default function Continue() {
  const { candidates, loading } = useResume();
  const top = candidates[0];
  if (loading || !top) return null;

  const { label, action } = RESUME_KIND_COPY[top.kind];
  const Icon = KIND_ICON[top.kind];
  return (
    // The accent border and the filled action mark this as the card to look at.
    // A tinted fill would say the same thing, but `bg-primary/5` measured 4.15:1
    // for the muted lines in the light scheme against 4.63:1 on the card
    // surface, so the tint costs more contrast than the light ramp has to spare
    // (see #997).
    <section
      aria-labelledby="home-continue-title"
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-primary/40 bg-card p-5 text-card-foreground"
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <h2 id="home-continue-title" className="text-xl font-semibold">
            {top.title}
          </h2>
          <p className="text-sm text-muted-foreground">{top.detail}</p>
        </div>
      </div>
      <Link to={top.to} className={cn(buttonVariants(), "shrink-0")}>
        <Play className="size-4" aria-hidden />
        {action}
      </Link>
    </section>
  );
}
