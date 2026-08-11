import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Archive as ArchiveIcon,
  Boxes,
  FolderTree,
  Gamepad2,
  HardDrive,
  Library,
  Map as MapIcon,
  Monitor,
  MousePointer2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import ContentStartupProvider from "./ContentStartupProvider";
import { engineConfigPage } from "./pages/EngineConfigPage";
import EngineProfilesSection from "./pages/EngineProfilesSection";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";
import { makeLegacyRedirect } from "./pages/LegacyRedirect";
import StorageSection from "./pages/StorageSection";

/**
 * The content plugin's frontend half. It owns the **Content** sidebar section,
 * Maps and Games browsed from the installed engines via libunitsync (the
 * `tauri-plugin-coilbox-unitsync` worker), and keeps the configuration-shaped
 * settings sections. Pair with the `tauri-plugin-coilbox-content` crate (ACL id
 * `coilbox-content`), whose persisted state.json is the cross-plugin read API for
 * where game content lives.
 *
 * Its settings live in two places, because they answer to two different readers.
 * Engine Settings (`/settings/engine-settings`, the `springsettings.cfg` values read
 * and written through unitsync) is what a player came to settings for, so it sits
 * near the top. Content folders, Engines and Storage are about files on disk, so
 * they sit in the Content group further down, alongside Downloads and Import,
 * which other plugins declare into the same group.
 *
 * Replays (now under Singleplayer, `play/index.ts`) and the stats profile (now
 * under Multiplayer as "Player stats", `multiplayer/index.tsx`) moved out of this
 * group in #467; their old `content/replays*`/`content/stats*` paths still route
 * here purely to redirect to the new locations, via `LegacyRedirect`.
 *
 * Setup packs (`../packs`) used to have its own page here too, at
 * `content/setup-packs`. Sharing a pack now happens from the Coilbox hub
 * screen instead, where sharing already lives; the old path stays wired up
 * as a redirect to Downloads > Maps, the same way the replays/stats paths
 * redirect above, so an old shared link still lands somewhere useful.
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
    {
      path: "content/setup-packs",
      lazy: async () => ({
        default: makeLegacyRedirect(() => "/downloads/maps"),
      }),
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
    // Engine Settings: what a player came to settings for, so it sits third,
    // under the two the frame pins. A group with no Component of its own, which
    // makes the frame render an index of the pages below it. The id is
    // unchanged from when this was one page, so `/settings/engine-settings`
    // still lands somewhere sensible.
    //
    // The five category pages are the worker's own categories, so a setting
    // added to its catalog lands on the right page with no change here.
    {
      id: "engine-settings",
      title: "Engine Settings",
      description: "How the game itself looks, sounds and handles.",
      order: 20,
      icon: SlidersHorizontal,
    },
    {
      id: "engine-display",
      title: "Display",
      description: "Fullscreen, resolution and vsync.",
      parent: "engine-settings",
      order: 10,
      icon: Monitor,
      Component: engineConfigPage("Display"),
    },
    {
      id: "engine-graphics",
      title: "Graphics",
      description: "Shadows, water, particles and anti-aliasing.",
      parent: "engine-settings",
      order: 20,
      icon: Sparkles,
      Component: engineConfigPage("Graphics"),
    },
    {
      id: "engine-sound",
      title: "Sound",
      description: "Volume, channel by channel.",
      parent: "engine-settings",
      order: 30,
      icon: Volume2,
      Component: engineConfigPage("Sound"),
    },
    {
      id: "engine-input",
      title: "Input and camera",
      description: "Camera mode, edge scrolling and the mouse.",
      parent: "engine-settings",
      order: 40,
      icon: MousePointer2,
      Component: engineConfigPage("Input & Camera"),
    },
    {
      id: "engine-game",
      title: "In game",
      description: "Your player name and team highlighting.",
      parent: "engine-settings",
      order: 50,
      icon: Gamepad2,
      Component: engineConfigPage("General"),
    },
    {
      id: "engine-profiles",
      title: "Saved configs",
      description: "Keep a copy of your whole engine config, and put it back.",
      parent: "engine-settings",
      order: 60,
      icon: Save,
      Component: EngineProfilesSection,
    },
    // Content: the files on disk and where they come from. Configuration rather
    // than play, so it sits below everything a player touches while playing.
    {
      id: "content",
      title: "Content",
      description:
        "Where your games, maps and engines live, and where new ones come from.",
      order: 80,
      icon: Library,
    },
    {
      id: "content-folders",
      title: "Content folders",
      description: "The folders coilbox reads games and maps from.",
      parent: "content",
      order: 10,
      icon: FolderTree,
      Component: FoldersSection,
    },
    {
      id: "engines",
      title: "Engines",
      description: "The engine versions you have, and getting more.",
      parent: "content",
      order: 20,
      icon: Boxes,
      Component: EnginesSection,
    },
    {
      id: "storage",
      title: "Storage",
      description: "What is taking up space, and clearing it out.",
      parent: "content",
      order: 40,
      icon: HardDrive,
      width: "lg",
      Component: StorageSection,
    },
  ],
};

export default contentPlugin;
