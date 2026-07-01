import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Swords } from "lucide-react";

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
      ],
    },
  ],
  routes: [
    {
      path: "play/skirmish",
      lazy: () => import("./pages/SkirmishPage"),
      crumb: "Singleplayer",
    },
  ],
};

export default playPlugin;
