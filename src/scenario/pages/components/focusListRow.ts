/**
 * Bring a panel's row on screen and give it the keyboard focus, the way a
 * mission problem's row asks the panel that owns it to (issue #2271).
 *
 * The same technique `scrollToAnchor` in `markdownAnchors.ts` uses for a `#`
 * link: read `prefers-reduced-motion` straight off the document rather than
 * through `useReduceMotion`, because this runs outside React, from a
 * `requestAnimationFrame` callback rather than a render.
 */

/**
 * Scroll `el` into view and focus it, or its first focusable child when `el`
 * itself is not one. A trigger's and an objective's own row is a `<button>`,
 * so `el` is what gets focused. A variable's is a `<li>` around its name and
 * value boxes, so the name box is what an author lands in, ready to fix it.
 */
export function focusListRow(el: HTMLElement): void {
  const reduced = el.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  const target = el.matches("button, input, [tabindex]")
    ? el
    : el.querySelector<HTMLElement>("button, input, [tabindex]");
  target?.focus({ preventScroll: true });
}
