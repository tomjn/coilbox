import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Boxes, FolderTree, Gamepad2, Map as MapIcon } from "lucide-react";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";

/**
 * The content plugin's frontend half. It owns the **Content** sidebar section —
 * Maps and Games browsed from the installed engines via libunitsync (the
 * `tauri-plugin-coilbox-unitsync` worker) — and keeps two configuration-shaped
 * settings sections: Content Folders (Spring/Recoil data roots) and Engines
 * (installs found within them), at `/settings/content-folders` and
 * `/settings/engines`. (Replays etc. join the sidebar group later.) Pair with the
 * `tauri-plugin-coilbox-content` crate (ACL id `coilbox-content`), whose persisted
 * state.json is the cross-plugin read API for where game content lives.
 *
 * Route Components are lazy-loaded; settings Components are imported eagerly (not
 * lazy): the frame settings page renders them directly without a Suspense
 * boundary, so React.lazy can't be used there.
 */
const contentPlugin: FramePlugin = {
  id: "content",
  version: "0.0.0",
  nav: [
    {
      id: "content",
      label: "Content",
      order: 15,
      items: [
        {
          id: "content.maps",
          label: "Maps",
          to: "/content/maps",
          order: 0,
          icon: MapIcon,
        },
        {
          id: "content.games",
          label: "Games",
          to: "/content/games",
          order: 1,
          icon: Gamepad2,
        },
      ],
    },
  ],
  routes: [
    {
      path: "content/maps",
      lazy: () => import("./pages/MapsPage"),
      crumb: "Maps",
    },
    {
      path: "content/maps/:name",
      lazy: () => import("./pages/MapDetailPage"),
      crumb: (c) => c.params.name ?? "Map",
    },
    {
      path: "content/games",
      lazy: () => import("./pages/GamesPage"),
      crumb: "Games",
    },
    {
      path: "content/games/:name",
      lazy: () => import("./pages/GameDetailPage"),
      crumb: (c) => c.params.name ?? "Game",
    },
  ],
  settings: [
    {
      id: "content-folders",
      title: "Content Folders",
      icon: FolderTree,
      Component: FoldersSection,
    },
    {
      id: "engines",
      title: "Engines",
      icon: Boxes,
      Component: EnginesSection,
    },
  ],
};

export default contentPlugin;
