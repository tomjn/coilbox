import { getProfile } from "../profile/profile";
import { publishArtOverrides } from "./artOverride";
import BrandedHome from "./BrandedHome";
import { resolveHome } from "./config";
import { homeMode, resolveLayout } from "./layout";
import { resolveCardArtOverrides } from "./profileArt";
import { suggestedMapClaim, useSuggestedMap } from "./suggestedMap";
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
 * - Everything else gets the layout `profile.home` selects, assembled from the
 *   zones it lists (see `./config`).
 *
 * The branded arm reads no `home` key, and deliberately gets no backdrop. A
 * distribution that replaced the page wholesale already sets its own background
 * in `welcome.css`, at full strength, where `home.background` is capped at 5% so
 * that Coilbox's own zones stay legible over it. Honouring it here would be a
 * second, weaker way to do something the arm can already do.
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
 *
 * The distribution's own per-tool art is published the same way and from the
 * same place, because it is the same kind of decision: art belongs to the page
 * rather than to a zone, so that the cards settle their pictures against each
 * other. It is published first so the content picks can see it (see
 * {@link ./artOverride}).
 *
 * The suggested map is resolved here for the same reason again. Its card is not
 * a tool card and is not in the grid, but the map it shows is a picture on this
 * page, so the tool cards have to settle around it (issue #1055). Deciding it
 * above the layout is what keeps that a page-wide answer rather than a race
 * between two zones. The zone below resolves the same map from the same inputs
 * and renders it; nothing is passed down.
 */
function LayoutHome() {
  const { layout, background, entries } = resolveHome(getProfile().home);
  const { map } = useSuggestedMap();
  const shown = entries.some(
    (e) => e.kind === "zone" && e.zone === "suggested",
  );
  publishArtOverrides(resolveCardArtOverrides(entries));
  useContentCardArt(suggestedMapClaim(map, shown));
  const Layout = resolveLayout(layout);
  return <Layout entries={entries} background={background} />;
}
