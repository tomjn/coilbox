import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Archive as ArchiveIcon,
  Blocks,
  Boxes,
  FolderTree,
  Gamepad2,
  HardDrive,
  Keyboard,
  Library,
  Map as MapIcon,
  Monitor,
  MousePointer2,
  Save,
  SlidersHorizontal,
  Sparkles,
  Volume2,
} from "lucide-react";
import { cachedBlueprint } from "../blueprint/store";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import ContentStartupProvider from "./ContentStartupProvider";
import { engineConfigPage } from "./pages/EngineConfigPage";
import EngineProfilesSection from "./pages/EngineProfilesSection";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";
import KeybindsSection from "./pages/KeybindsSection";
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
/**
 * The browser paths that moved from `content/` to `library/`, relative to both
 * prefixes.
 *
 * One list, read twice: once to build the live `library/` routes' retired twins,
 * and once by the test that checks every live route has one. Kept beside the
 * routes rather than in the profile's rename map, because these are paths a
 * player pasted somewhere, and that map is about ids a profile author wrote.
 */
export const RENAMED_TO_LIBRARY: readonly string[] = [
  "maps",
  "maps/:name",
  "games",
  "games/:name",
  "games/:name/units",
  "games/:name/units/:unit",
  "blueprints",
  "blueprints/:id",
  "archives",
  "archives/:name",
  "archives/:name/repl",
];

const contentPlugin: FramePlugin = {
  id: "content",
  version: "0.0.0",
  // Runs once at app launch (before any route opens) to warm the unitsync scan
  // and map thumbnails, so the Maps/Games pages show data instantly.
  Provider: ContentStartupProvider,
  nav: [
    {
      id: "library",
      label: "Library",
      order: 15,
      items: [
        {
          id: "library.maps",
          label: "Maps",
          to: "/library/maps",
          order: 0,
          icon: MapIcon,
        },
        {
          id: "library.games",
          label: "Games",
          to: "/library/games",
          order: 1,
          icon: Gamepad2,
          // A single-game distribution can hide the multi-game browser.
          useVisible: () => !isProfileHidden("library.games"),
        },
        {
          // Layouts you keep, beside the maps and games they are drawn for and
          // above the modding tool below (issue #1415).
          id: "library.blueprints",
          label: "Blueprints",
          to: "/library/blueprints",
          order: 1.5,
          icon: Blocks,
        },
        {
          // Archive explorer is a modding tool — gated behind advanced mode,
          // unlike the player-facing Maps/Games in this same group.
          id: "library.archives",
          label: "Archives",
          to: "/library/archives",
          order: 2,
          icon: ArchiveIcon,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "library/maps",
      lazy: () => import("./pages/MapsPage"),
      crumb: "Maps",
    },
    {
      path: "library/maps/:name",
      lazy: () => import("./pages/MapDetailPage"),
      crumb: (c) => c.params.name ?? "Map",
    },
    {
      path: "library/games",
      lazy: gateProfileHidden(
        "library.games",
        () => import("./pages/GamesPage"),
      ),
      crumb: "Games",
    },
    {
      path: "library/games/:name",
      lazy: gateProfileHidden(
        "library.games",
        () => import("./pages/GameDetailPage"),
      ),
      crumb: (c) => c.params.name ?? "Game",
    },
    {
      path: "library/games/:name/units",
      lazy: gateProfileHidden(
        "library.games",
        () => import("./pages/GameUnitsPage"),
      ),
      crumb: "Units",
    },
    {
      // The crumb is the def key rather than the display name, because it
      // renders before the dataset is read. A def key is a worse label than a
      // name and a better one than nothing, the same trade the blueprint
      // route already makes for a uuid.
      path: "library/games/:name/units/:unit",
      lazy: gateProfileHidden(
        "library.games",
        () => import("./pages/GameUnitPage"),
      ),
      crumb: (c) => c.params.unit ?? "Unit",
    },
    {
      // The blueprint library (issue #1415). Its pages live under
      // `../blueprint/`, with the model and the store they read, because a
      // layout is its own thing rather than part of the content browser.
      path: "library/blueprints",
      lazy: () => import("../blueprint/pages/BlueprintsPage"),
      crumb: "Blueprints",
    },
    {
      // The route param is an opaque uuid, so the crumb resolves the layout's
      // name from the session cache, falling back when the list is not read.
      path: "library/blueprints/:id",
      lazy: () => import("../blueprint/pages/BlueprintDetailPage"),
      crumb: (c) =>
        (c.params.id && cachedBlueprint(c.params.id)?.layout.name) ||
        "Blueprint",
    },
    {
      path: "library/archives",
      lazy: gateAdvanced(() => import("./pages/ArchivesPage")),
      crumb: "Archives",
    },
    {
      path: "library/archives/:name",
      lazy: gateAdvanced(() => import("./pages/ArchiveDetailPage")),
      crumb: (c) => c.params.name ?? "Archive",
    },
    {
      path: "library/archives/:name/repl",
      lazy: gateAdvanced(() => import("./pages/ArchiveReplPage")),
      crumb: (c) =>
        c.params.name ? `${c.params.name} · Lua REPL` : "Lua REPL",
    },
    {
      path: "content/setup-packs",
      lazy: async () => ({
        default: makeLegacyRedirect("/downloads/maps"),
      }),
    },
    // The browser paths retired when Content became Library. Every live route
    // above has one, built from the same list so a page cannot gain a `library/`
    // path without its old `content/` one following. Deep links to these are
    // everywhere a player can paste a URL, and the four already-retired paths
    // below stay where they are rather than gaining `library/` twins nobody
    // should be writing.
    ...RENAMED_TO_LIBRARY.map((path) => ({
      path: `content/${path}`,
      lazy: async () => ({
        default: makeLegacyRedirect(`/library/${path}`),
      }),
    })),
    // Legacy paths (#467 moved Replays to Singleplayer and Stats to
    // Multiplayer as "Player stats") — kept so old bookmarks and provenance
    // links already written into `content.replayState` still resolve.
    {
      path: "content/replays",
      lazy: async () => ({
        default: makeLegacyRedirect("/play/replays"),
      }),
    },
    {
      path: "content/replays/:name",
      lazy: async () => ({
        default: makeLegacyRedirect("/play/replays/:name"),
      }),
    },
    {
      path: "content/stats",
      lazy: async () => ({ default: makeLegacyRedirect("/stats") }),
    },
    {
      path: "content/stats/:name",
      lazy: async () => ({
        default: makeLegacyRedirect("/stats/:name"),
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
    // Keybinds sits above Saved configs because saving a copy is what you do
    // after editing, and below the category pages because it is the one engine
    // setting that is not a springsettings.cfg value at all.
    {
      id: "engine-keybinds",
      title: "Keybinds",
      description: "What every key does, on a keyboard you can click.",
      parent: "engine-settings",
      order: 55,
      icon: Keyboard,
      width: "lg",
      Component: KeybindsSection,
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
      id: "library",
      title: "Library",
      description:
        "Where your games, maps and engines live, and where new ones come from.",
      order: 80,
      icon: Library,
    },
    {
      id: "content-folders",
      title: "Content folders",
      description: "The folders coilbox reads games and maps from.",
      parent: "library",
      order: 10,
      icon: FolderTree,
      Component: FoldersSection,
    },
    {
      id: "engines",
      title: "Engines",
      description: "The engine versions you have, and getting more.",
      parent: "library",
      order: 20,
      icon: Boxes,
      Component: EnginesSection,
    },
    {
      id: "storage",
      title: "Storage",
      description: "What is taking up space, and clearing it out.",
      parent: "library",
      order: 40,
      icon: HardDrive,
      width: "lg",
      Component: StorageSection,
    },
  ],
};

export default contentPlugin;
