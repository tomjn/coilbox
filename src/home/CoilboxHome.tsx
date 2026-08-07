import { getProfile } from "../profile/profile";
import BrandedHome from "./BrandedHome";
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
 * - Everything else gets the configured layout, which currently reproduces
 *   picoframe's launcher exactly.
 */
export default function CoilboxHome() {
  if (homeMode(getProfile()) === "welcome") return <BrandedHome />;
  // Layout selection from `profile.home` arrives with the schema in issue #998.
  // Until then every install resolves to the default.
  const Layout = resolveLayout();
  return <Layout />;
}
