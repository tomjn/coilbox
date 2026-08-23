import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Clapperboard, FileText, Save, Swords } from "lucide-react";
import InGameBadge from "./InGameBadge";
import { PlayProvider } from "./PlayProvider";
import EngineLogSection from "./pages/EngineLogSection";

/**
 * The Play plugin's frontend half — a **Play** sidebar section whose first screen
 * is a Basic Singleplayer (skirmish) launcher. It configures a start script (map,
 * game, factions, AI opponents, colours, teams/allyteams, spectate) and launches
 * the preferred engine via the `tauri-plugin-coilbox-play` crate (ACL id
 * `coilbox-play`). Skirmish-AI enumeration comes from the unitsync plugin.
 *
 * Replays (list + detail) moved here from Content in #467; the pages themselves
 * still live in `content/pages` (they're built on the content plugin's unitsync
 * hooks) — only the nav item and route registration moved.
 */
const playPlugin: FramePlugin = {
  id: "play",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "play.skirmish",
          label: "Singleplayer",
          to: "/play/skirmish",
          order: 0,
          icon: Swords,
        },
        {
          id: "play.replays",
          label: "Replays",
          to: "/play/replays",
          order: 4,
          icon: Clapperboard,
        },
        {
          id: "play.savegames",
          label: "Save Games",
          to: "/play/savegames",
          // Last in the aggregated Play section (Campaigns=1, Conquest=2 arrive
          // from sibling plugins), so keep this clearly above them.
          order: 10,
          icon: Save,
        },
      ],
    },
  ],
  routes: [
    {
      path: "play/skirmish",
      lazy: () => import("./pages/SkirmishPage"),
      crumb: "Singleplayer",
    },
    {
      path: "play/replays",
      lazy: () => import("../content/pages/ReplaysPage"),
      crumb: "Replays",
    },
    {
      path: "play/replays/:name",
      lazy: () => import("../content/pages/ReplayDetailPage"),
      crumb: (c) => c.params.name ?? "Replay",
    },
    {
      path: "play/savegames",
      lazy: () => import("./pages/SavegamesPage"),
      crumb: "Save Games",
    },
  ],
  // Declared into Engine Settings, which the content plugin owns, because that
  // is where somebody goes looking for what the engine did. The code stays here
  // because the crash drawer it shares a viewer with is a play concern.
  settings: [
    {
      id: "engine-log",
      title: "Engine log",
      description: "What the engine last wrote down, and where it wrote it.",
      parent: "engine-settings",
      order: 70,
      icon: FileText,
      width: "lg",
      Component: EngineLogSection,
    },
  ],
  Provider: PlayProvider,
  slots: [{ slot: "topbar.right", order: -10, Component: InGameBadge }],
};

export default playPlugin;
