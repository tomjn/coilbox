import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Save, Swords } from "lucide-react";
import InGameBadge from "./InGameBadge";
import { PlayProvider } from "./PlayProvider";

/**
 * The Play plugin's frontend half — a **Play** sidebar section whose first screen
 * is a Basic Singleplayer (skirmish) launcher. It configures a start script (map,
 * game, factions, AI opponents, colours, teams/allyteams, spectate) and launches
 * the preferred engine via the `tauri-plugin-coilbox-play` crate (ACL id
 * `coilbox-play`). Skirmish-AI enumeration comes from the unitsync plugin.
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
          id: "play.savegames",
          label: "Savegames",
          to: "/play/savegames",
          order: 1,
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
      path: "play/savegames",
      lazy: () => import("./pages/SavegamesPage"),
      crumb: "Savegames",
    },
  ],
  Provider: PlayProvider,
  slots: [{ slot: "topbar.right", order: -10, Component: InGameBadge }],
};

export default playPlugin;
