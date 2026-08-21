import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Which way the app is allowed to scroll (#1804).
 *
 * Every route in coilbox renders inside one element, picoframe's content
 * region, and picoframe gives it `overflow-auto`. That means a route whose
 * content is too wide does not break. The page gains horizontal scroll instead,
 * and whatever ran past the right edge sits off screen until somebody drags
 * sideways. Nothing looks wrong, so nothing gets reported: #1795 sat there
 * unnoticed with the hub's last filter chip 96px past the edge at a 600px
 * window, which is the narrowest size coilbox supports.
 *
 * `src/index.css` clips that axis, so an overflow shows up as a control cut in
 * half rather than as a control nobody can find. This file is what keeps that
 * true, and it has three ways of going wrong, one per block below.
 *
 * The rule can be deleted. The rule can stay and stop matching anything,
 * because the region belongs to picoframe and a release is free to rename the
 * slot it hangs on. Or somebody can add a new sideways scroller of their own
 * and put back exactly the defect the rule was written for.
 *
 * The third one is the interesting case, because sideways scroll is sometimes
 * right. A wide table has to scroll: shrinking columns to fit is worse than a
 * scrollbar, and the scrollbar sits on the table rather than on the page, so it
 * reads as belonging to the thing it scrolls. The list below is the record of
 * which ones those are.
 */

const HERE = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const APP_CSS = readFileSync(HERE("../index.css"), "utf8");

/** The slot picoframe hangs the content region on. */
const SLOT = "content-scroll";

describe("the content region is clipped sideways", () => {
  /**
   * The shipped rule, selector and all, straight out of `src/index.css`. The
   * selector is matched rather than assumed, because a rule that matches
   * nothing looks exactly like a rule that works.
   */
  const rule = APP_CSS.match(
    /main\[data-slot="([^"]+)"\]\s*\{([^}]*)\}/,
  ) as RegExpMatchArray | null;

  it("declares the rule at all", () => {
    expect(
      rule,
      "src/index.css no longer clips the content region's horizontal axis. " +
        "Without it a route that is too wide scrolls the whole page sideways " +
        "and looks fine doing it, which is #1804.",
    ).not.toBeNull();
  });

  it("hides the horizontal axis and leaves the vertical one alone", () => {
    const body = rule?.[2] ?? "";
    expect(body).toMatch(/overflow-x:\s*hidden/);
    expect(
      body,
      "Do not name overflow-y here. The region has to keep scrolling down, " +
        "and that is picoframe's own overflow-auto doing it.",
    ).not.toMatch(/overflow-y:/);
  });

  it("hides rather than clips, so a cut-off control can still be scrolled to", () => {
    expect(
      rule?.[2] ?? "",
      "overflow-x: clip would stop the region being a scroll container, so " +
        "scrollIntoView could no longer bring a control past the edge onto " +
        "screen. hidden keeps that working and takes away only the drag.",
    ).not.toMatch(/overflow-x:\s*clip/);
  });
});

describe("the rule still lands on something picoframe renders", () => {
  const LAYOUT = readFileSync(
    HERE("../../node_modules/@picoframe/frame/dist/layout/AppLayout.js"),
    "utf8",
  );

  it("targets the slot the shipped layout puts on its content region", () => {
    const targeted = APP_CSS.match(/main\[data-slot="([^"]+)"\]/)?.[1];
    expect(targeted).toBe(SLOT);
    expect(
      LAYOUT.includes(`"data-slot": "${SLOT}"`),
      `@picoframe/frame no longer renders a data-slot="${SLOT}". The rule in ` +
        "src/index.css now matches nothing, so every route can scroll " +
        "sideways again with no symptom. Find what the region is called in " +
        "the new release and update both the rule and this test, or take the " +
        "fix upstream and drop them.",
    ).toBe(true);
  });

  it("is still needed, because picoframe still scrolls both axes", () => {
    const main = LAYOUT.slice(LAYOUT.indexOf(`"data-slot": "${SLOT}"`));
    const className = main.match(/className:\s*"([^"]*)"/)?.[1] ?? "";
    expect(
      className,
      "picoframe's content region no longer asks for overflow-auto. If it " +
        "now decides its own horizontal axis, the override in src/index.css " +
        "is dead weight and should go.",
    ).toContain("overflow-auto");
  });
});

describe("sideways scroll is declared, not stumbled into", () => {
  /**
   * Every place in coilbox that deliberately scrolls sideways, and why.
   *
   * A container on this list scrolls its own content, inside its own box, and
   * that is the right answer for what it holds. The defect #1804 is about is
   * the other kind: a page that scrolls sideways as a whole, which is never
   * something anybody chose.
   *
   * Adding to this list is a decision. If the content can wrap, wrap it, which
   * is what #1803 did for the hub's filter chips. Reach for a scroller only
   * when the content genuinely cannot be narrowed.
   */
  const DELIBERATE: Record<string, string> = {
    "components/ui/table.tsx":
      "A table's own scroller. Columns cannot be squeezed indefinitely, and " +
      "the scrollbar sits on the table rather than on the page.",
    "content/pages/components/BrandingScreenshots.tsx":
      "A strip of screenshots, read by scrolling along it. Wrapping it into " +
      "rows would make it a gallery, which is a different thing.",
    "multiplayer/chat/FormattedText.tsx":
      "A code block in a chat message. Wrapping code changes what it says.",
    "profile/HealthChecklist.tsx":
      "A command to copy and run. Wrapping it would hide where the line ends.",
  };

  /** How a file asks for it, as opposed to how a comment discusses it. */
  const SIDEWAYS = /\boverflow-x-(auto|scroll)\b/;

  /**
   * A file with its comments taken out, so that this codebase explaining the
   * rule does not read as a file breaking it.
   */
  function markup(path: string): string {
    return readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");
  }

  const root = HERE("..");
  const sources = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".tsx") &&
        !entry.name.endsWith(".test.tsx"),
    )
    .map((entry) => `${entry.parentPath}/${entry.name}`);

  const scrollers = sources
    .filter((path) => SIDEWAYS.test(markup(path)))
    .map((path) => path.slice(root.length).replace(/^\/+/, ""))
    .sort();

  it("scrolls sideways only where the list above says why", () => {
    expect(
      scrollers.filter((path) => !(path in DELIBERATE)),
      "A new sideways scroller. If the content can wrap, wrap it: a row that " +
        "wraps hides nothing, and a row that scrolls hides everything past " +
        "the edge behind a gesture nobody knows is there (#1804). If it " +
        "genuinely cannot wrap, add it to DELIBERATE with the reason.",
    ).toEqual([]);
  });

  it("keeps no entry for a scroller that has gone", () => {
    expect(
      Object.keys(DELIBERATE).filter((path) => !scrollers.includes(path)),
      "This file no longer scrolls sideways, so the entry above is stale. " +
        "Drop it, so the list keeps describing the app.",
    ).toEqual([]);
  });
});
