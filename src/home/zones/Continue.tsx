import { buttonVariants, cn } from "@picoframe/frame";
import { Play } from "lucide-react";
import { Link } from "react-router";
import { CARD_FOCUS_CLASS, GROUP_HEADING_CLASS } from "../cardShell";
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
 * So the label is the heading and the name is the text under it. Nothing moved
 * on screen when that changed: the label already carried the tool grid's
 * group-heading styling, so the page was drawing it as a section heading and
 * only the tag was wrong. It still tracks that styling, which is now
 * full-strength ink rather than muted.
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
 * ## The whole card is the action
 *
 * There is one thing to do here, so there is one target and it is the card. The
 * rail's cards beside it already work this way, and a card that is entirely a
 * link cannot leave a reader guessing which part of it is clickable.
 *
 * That also fixes what the button had become. Spelled out ("Resume conquest")
 * and filled, it was the loudest thing on the page while sitting next to a
 * heading that already said Conquest and a title that already named the run. The
 * words were a third copy. Now the icon carries it at `size="icon"`, the words
 * live in the link's label, and the card's own text says what it goes back to.
 *
 * The affordance is a `span`, not a button or a second link. It sits inside the
 * card's link, and nesting one interactive element in another is invalid markup
 * that assistive technology handles badly. Nothing is lost by it being inert:
 * the whole card already does the one thing it would have done.
 *
 * ## It is the same height as the cards beside it
 *
 * `p-4` here against the rail card's `p-2.5`. Two different cards holding
 * different things, so their heights agree by arrangement rather than by either
 * one measuring the other. At `p-5` and `p-3` this card was 105px and its
 * neighbours 101px, and it stood proud of the row for no reason a reader could
 * see. `ResumeRail` carries the rest of that note.
 *
 * Packed left rather than pinned to the far edge, which predates this and still
 * holds. `justify-between` made the gap between the words and the action
 * whatever the card had spare: on a 1256px page that measured 166px with two
 * rail cards beside it, 434px with one and 702px with none (#1059), so the page
 * with a single thing to resume, the page the hero matters most on, was the one
 * that looked the emptiest.
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
        "rounded-lg border border-primary/40 bg-card text-card-foreground",
        className,
      )}
    >
      {/* Named for the thing it resumes, not just for the verb. Read out of its
          visual context the verb alone was "Open setup" with no setup named, so
          a screen reader listing the page's links (which is how many people
          navigate one) had the page's most important control saying the least.
          The action's own words open the label, so voice control still reaches
          it by the icon's tooltip and by what the card says. */}
      <Link
        to={top.to}
        aria-label={`${action}: ${top.title}`}
        className={cn(
          "flex flex-wrap items-center gap-4 rounded-lg p-4 transition-colors hover:bg-accent/50",
          CARD_FOCUS_CLASS,
        )}
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="size-6" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          {/* The heading is the kind, not the run's name. See above. A heading
              inside a link is valid, and the link's own label is what gets read
              as its name, so both lists the page is navigated by still work. */}
          <h2 id="home-continue-heading" className={GROUP_HEADING_CLASS}>
            {label}
          </h2>
          <p className="text-xl font-semibold">{top.title}</p>
          <p className="text-sm text-muted-foreground">{top.detail}</p>
        </div>
        {/* Inert. The card around it is the link. `title` so a pointer user who
            wants the words can still get them. */}
        <span
          aria-hidden
          title={action}
          className={cn(buttonVariants({ size: "icon" }), "shrink-0")}
        >
          <Play className="size-4" />
        </span>
      </Link>
    </section>
  );
}
