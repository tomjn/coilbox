import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Download, Gamepad2, Map as MapIcon, Package } from "lucide-react";
import DownloadsSettings from "./pages/SettingsSection";

/**
 * The downloads plugin's frontend half. Contributes a nav group and a single
 * lazy route: a rapid-repo explorer that lists downloadable content and triggers
 * downloads through the bundled `pr-downloader` sidecar. A settings section
 * (rapid repositories + download destination) is hosted in the frame settings
 * page at `/settings/downloads`. Pair it with the
 * `tauri-plugin-coilbox-downloads` crate (ACL id `coilbox-downloads`).
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const downloadsPlugin: FramePlugin = {
  id: "downloads",
  version: "0.0.0",
  nav: [
    {
      id: "downloads",
      label: "Downloads",
      order: 20,
      items: [
        {
          id: "downloads.browse",
          label: "Browse Rapid",
          to: "/downloads",
          end: true,
          order: 0,
          icon: Package,
        },
        {
          id: "downloads.maps",
          label: "Maps",
          to: "/downloads/maps",
          order: 1,
          icon: MapIcon,
        },
        {
          id: "downloads.games",
          label: "Games",
          to: "/downloads/games",
          order: 2,
          icon: Gamepad2,
        },
      ],
    },
  ],
  routes: [
    {
      path: "downloads",
      lazy: () => import("./pages/ExplorerPage"),
      crumb: "Browse Rapid",
    },
    {
      path: "downloads/maps",
      lazy: () => import("./pages/MapsPage"),
      crumb: "Maps",
    },
    {
      path: "downloads/games",
      lazy: () => import("./pages/GamesPage"),
      crumb: "Games",
    },
  ],
  settings: [
    {
      id: "downloads",
      title: "Downloads",
      icon: Download,
      Component: DownloadsSettings,
    },
  ],
};

export default downloadsPlugin;
