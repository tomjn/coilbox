import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Package } from "lucide-react";

/**
 * The downloads plugin's frontend half. Contributes a nav group and a single
 * lazy route: a rapid-repo explorer that lists downloadable content and triggers
 * downloads through the bundled `pr-downloader` sidecar. Pair it with the
 * `tauri-plugin-coilbox-downloads` crate (ACL id `coilbox-downloads`).
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
      ],
    },
  ],
  routes: [
    {
      path: "downloads",
      lazy: () => import("./pages/ExplorerPage"),
      crumb: "Downloads",
    },
  ],
};

export default downloadsPlugin;
