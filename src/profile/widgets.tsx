import { type ReactNode, useEffect, useState } from "react";
import { BuildTreeEmbed } from "../content/pages/components/BuildTreeEmbed";
import { HomeSetupCard } from "../content/pages/components/SetupCard";
import { dlInstalledContent } from "../downloads/bindings";
import { useContentRootPaths, useWriteRootPath } from "../downloads/config";
import { MapPacksBanner } from "../downloads/pages/components/MapPacksBanner";
import BrandedWelcome from "./BrandedWelcome";

/**
 * The `@widget/<name>` registry (issue #274): a fixed allow-list of live Coilbox
 * components a distribution can embed into a custom markdown page, so the branded GUI is
 * composable. Only these names render — an unknown name is shown as a visible placeholder
 * (see {@link PageWidget}), never arbitrary code. Each entry is a thunk taking the
 * optional slash arg (`@widget/build-tree/<game>`); the drop-in cards ignore it.
 */

/**
 * `@widget/map-pack` — the map-pack download banner, standalone. It self-resolves its
 * pack list from the branding catalog + profile; the only data it needs supplied is the
 * installed-maps set and the write path, resolved here from the downloads config exactly
 * as GetStartedCard does (both hooks/command are self-contained — no scoped provider).
 */
function MapPackWidget() {
  const rootPaths = useContentRootPaths();
  const writePath = useWriteRootPath();
  const [maps, setMaps] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (rootPaths.length === 0) {
      setMaps(new Set());
      return;
    }
    dlInstalledContent({ paths: rootPaths })
      .then(({ maps }) => setMaps(new Set(maps)))
      .catch(() => setMaps(new Set()));
  }, [rootPaths]);
  return <MapPacksBanner installed={maps} writePath={writePath} />;
}

export const WIDGET_REGISTRY: Record<string, (arg?: string) => ReactNode> = {
  onboarding: () => <HomeSetupCard />,
  welcome: () => <BrandedWelcome />,
  "map-pack": () => <MapPackWidget />,
  "build-tree": (arg) => <BuildTreeEmbed arg={arg} mode="graph" />,
  "faction-button": (arg) => <BuildTreeEmbed arg={arg} mode="buttons" />,
};

/**
 * Render one `@widget/<name>` token. An unknown name renders a visible placeholder (not
 * a crash or a silent blank) so a typo in a distribution's markdown is obvious.
 */
export function PageWidget({ name, arg }: { name: string; arg?: string }) {
  const make = WIDGET_REGISTRY[name];
  if (!make) {
    return (
      <div className="my-3 rounded-md border border-dashed border-muted-foreground/40 px-4 py-3 text-sm text-muted-foreground">
        Unknown widget: <code>@widget/{name}</code>
      </div>
    );
  }
  return <>{make(arg)}</>;
}
