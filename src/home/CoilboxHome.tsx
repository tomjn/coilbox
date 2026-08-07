import { getProfile } from "../profile/profile";
import BrandedHome from "./BrandedHome";
import { resolveHome } from "./config";
import { homeMode, resolveLayout } from "./layout";

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
 * in `welcome.css`, at full strength, where `home.background` is capped at 6% so
 * that Coilbox's own zones stay legible over it. Honouring it here would be a
 * second, weaker way to do something the arm can already do.
 */
export default function CoilboxHome() {
  const profile = getProfile();
  if (homeMode(profile) === "welcome") return <BrandedHome />;
  const { layout, background, entries } = resolveHome(profile.home);
  const Layout = resolveLayout(layout);
  return <Layout entries={entries} background={background} />;
}
