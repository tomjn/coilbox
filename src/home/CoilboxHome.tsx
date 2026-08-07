import { getProfile } from "../profile/profile";
import BrandedHome from "./BrandedHome";
import { homeMode, resolveLayout } from "./layout";
import { useContentCardArt } from "./useContentCardArt";

/**
 * Coilbox's `/` page, installed unconditionally by `main.tsx`.
 *
 * picoframe ships a launcher so an app has a usable home from day one. Coilbox
 * has outgrown it: the valuable things a home could say here (the Warpath run
 * you abandoned, the campaign mission waiting) are exactly the domain concepts
 * picoframe cannot take upstream. So Coilbox forks it.
 *
 * Two arms, chosen by the distribution profile:
 *
 * - A profile with a `welcome` gets {@link BrandedHome}, which is what it got
 *   before. Wholesale replacement stays the escape hatch for distributions.
 * - Everything else gets the configured layout, which currently reproduces
 *   picoframe's launcher exactly.
 */
export default function CoilboxHome() {
  if (homeMode(getProfile()) === "welcome") return <BrandedHome />;
  return <LayoutHome />;
}

/**
 * The layout arm, split out so it can hold state.
 *
 * {@link useContentCardArt} resolves card art from the user's install after the
 * page has painted, and a card cannot re-render itself when that lands, so the
 * subscription has to sit above the layout. It lives here rather than in
 * {@link CoilboxHome} because the branded arm returns before it and a hook
 * cannot be called conditionally. Nothing is rendered for it. The art reaches
 * the cards through the chain in {@link ./art}, not through a prop.
 */
function LayoutHome() {
  useContentCardArt();
  // Layout selection from `profile.home` arrives with the schema in issue #998.
  // Until then every install resolves to the default.
  const Layout = resolveLayout();
  return <Layout />;
}
