import { classifyMarkdownLink } from "./pageLinks";

/**
 * The action a `data-coilbox-action` marker in the branded welcome HTML maps to
 * (issue #408). The welcome HTML can't run JavaScript, so a delegated click handler in
 * `BrandedWelcome` reads the marker off the clicked element and dispatches the result.
 *
 * - `quit` — close the app (the original, pre-#408 action).
 * - `navigate` — go to an in-app route. The route is taken from the element's
 *   `data-coilbox-route` (or its `href`) and resolved through {@link classifyMarkdownLink},
 *   so a welcome author writes exactly the same `@route/<path>` / `.md` / `/path` scheme a
 *   custom markdown page uses, and it resolves to the identical route.
 */
export type WelcomeAction =
  | { kind: "quit" }
  | { kind: "navigate"; to: string }
  /**
   * A file bundled in the `.coilbox` folder, named by the path relative to it.
   * A `navigate` marker resolves to this when it points at a file rather than at
   * a route, because an author who writes `@.coilbox/docs/guide.pdf` means "this
   * link leads to the guide" whichever attribute they wrote it in. It used to
   * resolve to nothing at all, so the click was swallowed (issue #1802).
   */
  | { kind: "open"; path: string };

/**
 * Resolve a welcome marker to a {@link WelcomeAction}, or `null` when it isn't actionable
 * (unknown action name, or a `navigate` that names nowhere Coilbox can lead).
 * Reusing the markdown link classifier keeps resolution in one place, so a `@widget/`,
 * external or malformed ref is a graceful no-op rather than a crash or a webview
 * blow-away, and a bundled file leads to the same place it leads from a page.
 */
export function resolveWelcomeAction(
  action: string | null | undefined,
  route: string | null | undefined,
): WelcomeAction | null {
  if (action === "quit") return { kind: "quit" };
  if (action === "navigate") {
    const target = classifyMarkdownLink(route ?? undefined);
    if (target.kind === "route") return { kind: "navigate", to: target.to };
    if (target.kind === "asset") return { kind: "open", path: target.path };
  }
  return null;
}
