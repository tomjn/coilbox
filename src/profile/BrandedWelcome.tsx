import { getProfile } from "./profile";

/**
 * The branded welcome landing page: replaces the default launcher home when the
 * profile supplies a `welcome`. Renders bundler-authored HTML plus its scoped CSS.
 *
 * The HTML is injected via `dangerouslySetInnerHTML`: it comes from a trusted,
 * bundler-controlled file shipped inside the distribution (same trust level as the
 * binary), and by design carries no `<script>` — declarative content only, so no
 * CSP relaxation is needed. Only used when `welcome` is present (main.tsx omits the
 * home override otherwise), so this component always has content to show.
 */
export default function BrandedWelcome() {
  const welcome = getProfile().welcome;
  if (!welcome) return null;
  return (
    <main className="h-full overflow-auto">
      {welcome.css && (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile CSS
        <style dangerouslySetInnerHTML={{ __html: welcome.css }} />
      )}
      {welcome.html && (
        <div
          className="coilbox-welcome"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted bundler-authored profile HTML
          dangerouslySetInnerHTML={{ __html: welcome.html }}
        />
      )}
    </main>
  );
}
