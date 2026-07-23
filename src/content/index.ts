import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Archive as ArchiveIcon,
  Boxes,
  FolderTree,
  Gamepad2,
  Map as MapIcon,
  SlidersHorizontal,
} from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import ContentStartupProvider from "./ContentStartupProvider";
import { HomeSetupCard } from "./pages/components/SetupCard";
import EngineSettingsSection from "./pages/EngineSettingsSection";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";
import { makeLegacyRedirect } from "./pages/LegacyRedirect";

/**
 * The content plugin's frontend half. It owns the **Content** sidebar section —
 * Maps and Games browsed from the installed engines via libunitsync (the
 * `tauri-plugin-coilbox-unitsync` worker) — and keeps two configuration-shaped
 * settings sections: Content Folders (Spring/Recoil data roots), Engines
 * (installs found within them), and Engine Settings (a curated, read-only view of
 * `springsettings.cfg` via unitsync), at `/settings/content-folders`,
 * `/settings/engines` and `/settings/engine-settings`. Pair with the
 * `tauri-plugin-coilbox-content` crate (ACL id `coilbox-content`), whose persisted
 * state.json is the cross-plugin read API for where game content lives.
 *
 * Replays (now under Singleplayer, `play/index.ts`) and the stats profile (now
 * under Multiplayer as "Player stats", `multiplayer/index.tsx`) moved out of this
 * group in #467; their old `content/replays*`/`content/stats*` paths still route
 * here purely to redirect to the new locations, via `LegacyRedirect`.
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
  // The first-run setup card rides the built-in home page's `home.top` slot
  // (above the launcher). It renders null once setup is complete, so a healthy
  // install sees only the launcher.
  slots: [{ slot: "home.top", order: 0, Component: HomeSetupCard }],
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
          // A single-game distribution can hide the multi-game browser.
          useVisible: () => !isProfileHidden("content.games"),
        },
        {
          // Archive explorer is a modding tool — gated behind advanced mode,
          // unlike the player-facing Maps/Games in this same group.
          id: "content.archives",
          label: "Archives",
          to: "/content/archives",
          order: 2,
          icon: ArchiveIcon,
          useVisible: useAdvancedMode,
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
      lazy: gateProfileHidden(
        "content.games",
        () => import("./pages/GamesPage"),
      ),
      crumb: "Games",
    },
    {
      path: "content/games/:name",
      lazy: gateProfileHidden(
        "content.games",
        () => import("./pages/GameDetailPage"),
      ),
      crumb: (c) => c.params.name ?? "Game",
    },
    {
      path: "content/archives",
      lazy: gateAdvanced(() => import("./pages/ArchivesPage")),
      crumb: "Archives",
    },
    {
      path: "content/archives/:name",
      lazy: gateAdvanced(() => import("./pages/ArchiveDetailPage")),
      crumb: (c) => c.params.name ?? "Archive",
    },
    {
      path: "content/archives/:name/repl",
      lazy: gateAdvanced(() => import("./pages/ArchiveReplPage")),
      crumb: (c) =>
        c.params.name ? `${c.params.name} · Lua REPL` : "Lua REPL",
    },
    // Legacy paths (#467 moved Replays to Singleplayer and Stats to
    // Multiplayer as "Player stats") — kept so old bookmarks and provenance
    // links already written into `content.replayState` still resolve.
    {
      path: "content/replays",
      lazy: async () => ({
        default: makeLegacyRedirect(() => "/play/replays"),
      }),
    },
    {
      path: "content/replays/:name",
      lazy: async () => ({
        default: makeLegacyRedirect(
          (name) => `/play/replays/${encodeURIComponent(name ?? "")}`,
        ),
      }),
    },
    {
      path: "content/stats",
      lazy: async () => ({ default: makeLegacyRedirect(() => "/stats") }),
    },
    {
      path: "content/stats/:name",
      lazy: async () => ({
        default: makeLegacyRedirect(
          (name) => `/stats/${encodeURIComponent(name ?? "")}`,
        ),
      }),
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
