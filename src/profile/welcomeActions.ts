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
export type WelcomeAction = { kind: "quit" } | { kind: "navigate"; to: string };

/**
 * Resolve a welcome marker to a {@link WelcomeAction}, or `null` when it isn't actionable
 * (unknown action name, or a `navigate` whose route doesn't resolve to an in-app route).
 * Reusing the markdown link classifier keeps route resolution in one place: only a
 * `route`-kind target navigates, so a `@widget/`, external, asset, or malformed ref is a
 * graceful no-op rather than a crash or a webview blow-away.
 */
export function resolveWelcomeAction(
  action: string | null | undefined,
  route: string | null | undefined,
): WelcomeAction | null {
  if (action === "quit") return { kind: "quit" };
  if (action === "navigate") {
    const target = classifyMarkdownLink(route ?? undefined);
    return target.kind === "route" ? { kind: "navigate", to: target.to } : null;
  }
  return null;
}
