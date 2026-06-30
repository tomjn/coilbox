import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Archive as ArchiveIcon,
  Boxes,
  Clapperboard,
  FolderTree,
  Gamepad2,
  Map as MapIcon,
  SlidersHorizontal,
} from "lucide-react";
import ContentStartupProvider from "./ContentStartupProvider";
import EngineSettingsSection from "./pages/EngineSettingsSection";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";

/**
 * The content plugin's frontend half. It owns the **Content** sidebar section —
 * Maps and Games browsed from the installed engines via libunitsync (the
 * `tauri-plugin-coilbox-unitsync` worker) — and keeps two configuration-shaped
 * settings sections: Content Folders (Spring/Recoil data roots), Engines
 * (installs found within them), and Engine Settings (a curated, read-only view of
 * `springsettings.cfg` via unitsync), at `/settings/content-folders`,
 * `/settings/engines` and `/settings/engine-settings`. (Replays etc. join the
 * sidebar group later.) Pair with the
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
  // Runs once at app launch (before any route opens) to warm the unitsync scan
  // and map thumbnails, so the Maps/Games pages show data instantly.
  Provider: ContentStartupProvider,
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
        {
          id: "content.archives",
          label: "Archives",
          to: "/content/archives",
          order: 2,
          icon: ArchiveIcon,
        },
        {
          id: "content.replays",
          label: "Replays",
          to: "/content/replays",
          order: 3,
          icon: Clapperboard,
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
    {
      path: "content/archives",
      lazy: () => import("./pages/ArchivesPage"),
      crumb: "Archives",
    },
    {
      path: "content/archives/:name",
      lazy: () => import("./pages/ArchiveDetailPage"),
      crumb: (c) => c.params.name ?? "Archive",
    },
    {
      path: "content/replays",
      lazy: () => import("./pages/ReplaysPage"),
      crumb: "Replays",
    },
    {
      path: "content/replays/:name",
      lazy: () => import("./pages/ReplayDetailPage"),
      crumb: (c) => c.params.name ?? "Replay",
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
    {
      id: "engine-settings",
      title: "Engine Settings",
      icon: SlidersHorizontal,
      Component: EngineSettingsSection,
    },
  ],
};

export default contentPlugin;
