import { useEffect, useMemo, useRef } from "react";
import { quitApp } from "../general/quit";
import { getProfile } from "./profile";
import { rewriteBrandedCss, rewriteBrandedHtml } from "./welcomeAssets";

/**
 * The branded welcome landing page: replaces the default launcher home when the
 * profile supplies a `welcome`. Renders bundler-authored HTML plus its scoped CSS.
 *
 * The HTML is injected via `dangerouslySetInnerHTML`: it comes from a trusted,
 * bundler-controlled file shipped inside the distribution (same trust level as the
 * binary), and by design carries no `<script>` — declarative content only, so no
 * CSP relaxation is needed. Only used when `welcome` is present (main.tsx omits the
 * home override otherwise), so this component always has content to show.
 *
 * Because the HTML can't run JavaScript, the one interactive hook an author gets is
 * the `data-coilbox-action` attribute: a delegated click handler on the container
 * reads it off the nearest ancestor of the click target. Currently only "quit" is
 * understood, letting an author's own button/link close the app.
 */
export default function BrandedWelcome() {
  const welcome = getProfile().welcome;
  // Rewrite relative asset URLs (images/audio/video/fonts) to the `coilbox://`
  // protocol so a bundler can reference `.coilbox/`-relative files by path. Memoised
  // on the raw strings so the DOM parse runs once, not every render.
  const html = useMemo(
    () => (welcome?.html ? rewriteBrandedHtml(welcome.html) : undefined),
    [welcome?.html],
  );
  const css = useMemo(
    () => (welcome?.css ? rewriteBrandedCss(welcome.css) : undefined),
    [welcome?.css],
  );
  // Delegated listener attached to the injected-HTML container (not a JSX `onClick`,
  // which would trip a11y lints on a static div): a bubbled click on any element
  // carrying `data-coilbox-action="quit"` closes the app.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onClick = (e: Event) => {
      const target = (e.target as HTMLElement).closest("[data-coilbox-action]");
      if (target?.getAttribute("data-coilbox-action") === "quit") {
        e.preventDefault();
        quitApp();
      }
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  if (!welcome) return null;
  return (
    // Natural height (not `h-full`): the SetupHome scroll container sizes and scrolls
    // this, so a short welcome can't collapse to zero the way `height:100%` does
    // against an auto-height parent inside picoframe's overflow-auto content region.
    <section className="w-full">
      {css && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile CSS
        <style dangerouslySetInnerHTML={{ __html: css }} />
      )}
      {html && (
        <div
          ref={ref}
          className="coilbox-welcome"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile HTML
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </section>
  );
}
