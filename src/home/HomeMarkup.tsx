import { useMemo } from "react";
import { useWelcomeActionRef } from "../profile/welcomeActionRef";
import { rewriteBrandedHtml } from "../profile/welcomeAssets";
import { homeMarkup } from "./markup";

/**
 * One block of a distribution's own markup on the home page: a zone's `before` or
 * `after`, or a custom `html` entry between zones (issue #999).
 *
 * The same trusted path the branded welcome uses, and deliberately not a second
 * one. The markup ships inside the distribution at the same trust level as the
 * binary, so injecting it is the same act as injecting `welcome.html`, and the
 * security argument in `BrandedWelcome` covers both unchanged: no `<script>`, so
 * no CSP relaxation, and the one interactive hook is the `data-coilbox-action`
 * attribute that {@link useWelcomeActionRef} delegates. Asset URLs go through
 * {@link rewriteBrandedHtml}, so `<img src="art/x.png">` resolves against the
 * portable `.coilbox/` folder here exactly as it does in the welcome, including
 * the `url()`s in any `<style>` block the markup carries.
 *
 * The distribution owns how this looks. The layout adds a `coilbox-home-markup`
 * class to target and no styling of its own, because it has no idea whether the
 * block is a sentence or a community feed.
 */
export default function HomeMarkup({ markup }: { markup: string }) {
  const { html, error } = homeMarkup(markup);
  // Memoised on the resolved text so the DOM parse runs once, not every render.
  const rewritten = useMemo(
    () => (html ? rewriteBrandedHtml(html) : undefined),
    [html],
  );
  const ref = useWelcomeActionRef();

  // Fail loud, matching the welcome: a reference that did not resolve is a
  // distribution bug its author has to be able to see.
  if (error)
    return (
      <div className="my-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  if (!rewritten) return null;
  return (
    <div
      ref={ref}
      className="coilbox-home-markup"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored distribution HTML
      dangerouslySetInnerHTML={{ __html: rewritten }}
    />
  );
}
