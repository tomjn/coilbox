import { buttonVariants, cn } from "@picoframe/frame";
import { Play } from "lucide-react";
import { Link } from "react-router";
import { RESUME_KIND_COPY, RESUME_KIND_ICON, useResume } from "../continue";

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
 * ## The heading is the kind, not the run
 *
 * The card's heading used to be the candidate's name, with the kind in a small
 * label above it. Listed by heading, which is how a lot of screen reader users
 * move around a page, that read "Welcome back, AF_ / Fractured Fringe / Play /
 * Multiplayer / Content": every heading on the page names a section except the
 * most important one, which named a thing and said nothing about what sort of
 * thing it was (#1091).
 *
 * So the label is the heading and the name is the text under it. Nothing moves
 * on screen: the label already carries the tool grid's group-heading styling
 * (`text-xs uppercase tracking-wide text-muted-foreground`), so the page was
 * already drawing it as a section heading and only the tag was wrong.
 *
 * What that costs is the run's name in the heading list. It is in the link list
 * instead, because the action beside it says "Resume run: Fractured Fringe"
 * (#1003), and the two lists are the two ways this page is navigated.
 *
 * The alternatives both changed the card to fix the markup. Folding the kind in
 * ("Warpath run: Fractured Fringe") drops the label line, flattens the card to
 * two lines and puts the name mid-sentence at the same weight as its category,
 * next to an action that then says "Resume run" again. An `aria-label` over the
 * name leaves the heading reading one way on screen and another out loud, which
 * is a thing to decide rather than to do quietly, and it papers over a heading
 * rather than fixing it.
 *
 * ## The action sits next to the text
 *
 * Not pinned to the far edge. `justify-between` put the icon, label, title and
 * detail on the left and the button on the right, so how far apart they ended up
 * was whatever the card had spare. On a 1256px page that measured 166px with two
 * rail cards beside it, 434px with one and 702px with none (#1059), so the page
 * with a single thing to resume, the page the hero matters most on, was the one
 * that looked the emptiest.
 *
 * Packed left, the action is the same short step from the words it acts on at
 * every width, and the card's spare room is one space at its end rather than a
 * hole through its middle. The card is sized to its content by the layout, so on
 * most pages there is no spare room to see.
 *
 * Layout-agnostic: no page-level spacing or width of its own, because the
 * `stacked` layout is a compatibility contract and a later layout has to be able
 * to put this card somewhere else. How wide the card is arrives as `className`
 * from whichever layout placed it, which is how `stacked` sits it beside the
 * resume rail (#1041) without either zone learning about the other.
 */
export default function Continue({ className }: { className?: string }) {
  const { candidates, loading } = useResume();
  const top = candidates[0];
  if (loading || !top) return null;

  const { label, action } = RESUME_KIND_COPY[top.kind];
  const Icon = RESUME_KIND_ICON[top.kind];
  return (
    // The accent border and the filled action mark this as the card to look at.
    // A tinted fill would say the same thing three times. The tint was also
    // unreadable when this was built, at 4.15:1 for the muted lines, but that was
    // the token's fault and is fixed in `src/index.css` (#1016), so the surface
    // stays `bg-card` on the design argument alone.
    <section
      aria-labelledby="home-continue-heading"
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-lg border border-primary/40 bg-card p-5 text-card-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0">
          {/* The heading is the kind, not the run's name. See below. */}
          <h2
            id="home-continue-heading"
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            {label}
          </h2>
          <p className="text-xl font-semibold">{top.title}</p>
          <p className="text-sm text-muted-foreground">{top.detail}</p>
        </div>
      </div>
      {/* Named for the thing it resumes, not just for the verb. The rail's cards
          are links wrapping their whole card, so each one reads out what it goes
          back to. This action is a button beside the title, and read on its own it
          was "Open setup" with no setup named, so a screen reader listing the
          page's links (which is how many people navigate one) had the page's most
          important control saying the least. The visible words open the label, so
          voice control still reaches it by what is written on it. */}
      <Link
        to={top.to}
        aria-label={`${action}: ${top.title}`}
        className={cn(buttonVariants(), "shrink-0")}
      >
        <Play className="size-4" aria-hidden />
        {action}
      </Link>
    </section>
  );
}
