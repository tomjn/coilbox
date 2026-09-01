import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Download,
  Gamepad2,
  Globe,
  Map as MapIcon,
  Package,
} from "lucide-react";
import CoilMark from "../general/CoilMark";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import DownloadQueueBadge from "./DownloadQueueBadge";
import { DownloadsProvider } from "./DownloadsProvider";
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
  // App-wide: syncs installed-engine dirs to the sidecar and hosts the serial
  // download queue, so an in-flight queue survives navigation.
  Provider: DownloadsProvider,
  // topbar widget: active progress + queued list while downloads run.
  slots: [{ slot: "topbar.right", order: 2, Component: DownloadQueueBadge }],
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
          useVisible: () => !isProfileHidden("downloads.browse"),
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
          // A distribution bundled with a single game can hide game downloads.
          useVisible: () => !isProfileHidden("downloads.games"),
        },
        // External references, home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener.
        {
          id: "downloads.hub",
          label: "Coilbox Hub",
          href: "https://coilbox-hub.vercel.app",
          icon: CoilMark,
          sidebar: false,
          order: 3,
        },
        {
          id: "downloads.springfiles",
          label: "Springfiles",
          href: "https://springfiles.springrts.com/",
          icon: Globe,
          sidebar: false,
          order: 4,
        },
      ],
    },
  ],
  routes: [
    {
      path: "downloads",
      lazy: gateProfileHidden(
        "downloads.browse",
        () => import("./pages/ExplorerPage"),
      ),
      crumb: "Browse Rapid",
    },
    {
      path: "downloads/maps",
      lazy: () => import("./pages/MapsPage"),
      crumb: "Maps",
    },
    {
      path: "downloads/games",
      lazy: gateProfileHidden(
        "downloads.games",
        () => import("./pages/GamesPage"),
      ),
      crumb: "Games",
    },
  ],
  settings: [
    {
      id: "downloads",
      title: "Downloads",
      description: "Where downloads come from and where they land.",
      parent: "content",
      order: 30,
      icon: Download,
      Component: DownloadsSettings,
    },
  ],
};

export default downloadsPlugin;
