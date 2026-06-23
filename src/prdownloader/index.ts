import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Package } from "lucide-react";

/**
 * The prdownloader plugin's frontend half. Contributes a nav group and a single
 * lazy route: a rapid-repo explorer that lists downloadable content and triggers
 * downloads through the bundled `pr-downloader` sidecar. Pair it with the
 * `tauri-plugin-coilbox-prdownloader` crate (ACL id `coilbox-prdownloader`).
 */
const prdownloaderPlugin: FramePlugin = {
  id: "prdownloader",
  version: "0.0.0",
  nav: [
    {
      id: "prdownloader",
      label: "pr-downloader",
      order: 20,
      items: [
        { id: "prdownloader.browse", label: "Browse", to: "/prdownloader", end: true, order: 0, icon: Package },
      ],
    },
  ],
  routes: [{ path: "prdownloader", lazy: () => import("./pages/ExplorerPage"), crumb: "pr-downloader" }],
};

export default prdownloaderPlugin;
