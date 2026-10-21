import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Download, Globe, History, Package } from "lucide-react";
import { makeLegacyRedirect } from "../content/pages/LegacyRedirect";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import CoilMark from "../general/CoilMark";
import { DEFAULT_HUB_URL, useHubUrl } from "../hub/config";
import { lazyText } from "../i18n/pluginText";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import DownloadQueueBadge from "./DownloadQueueBadge";
import { DownloadsProvider } from "./DownloadsProvider";
import DownloadsSettings from "./pages/SettingsSection";

/**
 * The browser paths of the Downloads group, retired when its pages went into the
 * Library (issue #4584), each with the page that replaced it.
 *
 * One map, read twice: once to build the redirect routes, and once by the test
 * that checks each one is registered. A player's bookmark, a Discord message and a
 * notification already in the history all point at these, and none of them can be
 * edited from here. The query string is kept, which a `coilbox://import` link
 * for a setup pack needs: its code rides on `/downloads/maps?import=`.
 */
export const RETIRED_DOWNLOADS_PATHS: Readonly<Record<string, string>> = {
  downloads: "/library/downloads",
  "downloads/maps": "/library/maps",
  "downloads/games": "/library/games",
};

/**
 * The downloads plugin's frontend half. It contributes the download queue and its
 * history page, a rapid-repo explorer for advanced users, and the Sources settings
 * section. Downloads are triggered through the bundled `pr-downloader` sidecar. The
 * items sit in the Library nav group the content plugin declares, because what a
 * mirror offers and what is on disk are one list there. Pair it with the
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
      // Groups merge by id across plugins.
      id: "library",
      label: lazyText(msg`Library`),
      order: 15,
      items: [
        {
          // The queue and its history (issue #4583).
          id: "library.downloads",
          label: lazyText(msg`Downloads`),
          to: "/library/downloads",
          order: 1.75,
          icon: History,
        },
        {
          // Beside Archives: a tool for people who run their own rapid master,
          // so it is behind advanced mode like the archive explorer.
          id: "library.rapid",
          label: lazyText(msg`Rapid repositories`),
          to: "/library/rapid",
          order: 2.5,
          icon: Package,
          useVisible: () =>
            useAdvancedMode() && !isProfileHidden("library.rapid"),
        },
        // External references, home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener. The hub's address is the
        // player's setting, so the home page reads it through `useHref` and
        // `href` is only what a surface that cannot run a hook would use.
        {
          id: "library.hubSite",
          label: lazyText(msg`Coilbox Hub`),
          href: DEFAULT_HUB_URL,
          useHref: useHubUrl,
          icon: CoilMark,
          sidebar: false,
          order: 3,
        },
        {
          id: "library.springfiles",
          label: lazyText(msg`Springfiles`),
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
      path: "library/downloads",
      lazy: () => import("./pages/ActivityPage"),
      crumb: lazyText(msg`Downloads`),
    },
    {
      path: "library/rapid",
      lazy: gateAdvanced(
        gateProfileHidden(
          "library.rapid",
          () => import("./pages/ExplorerPage"),
        ),
      ),
      crumb: lazyText(msg`Rapid repositories`),
    },
    ...Object.entries(RETIRED_DOWNLOADS_PATHS).map(([path, target]) => ({
      path,
      lazy: async () => ({ default: makeLegacyRedirect(target) }),
    })),
  ],
  settings: [
    {
      id: "sources",
      title: lazyText(msg`Sources`),
      description: lazyText(msg`Where games and maps come from.`),
      parent: "library",
      order: 30,
      icon: Download,
      Component: DownloadsSettings,
    },
  ],
};

export default downloadsPlugin;
