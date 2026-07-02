import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Swords } from "lucide-react";

/**
 * The multiplayer plugin's frontend half: a "Lobby" nav group and its routes,
 * backed by the `tauri-plugin-coilbox-multiplayer` crate (ACL id
 * `coilbox-multiplayer`). Connection state / mirror store and the battle-list, chat
 * and battle-room pages are filled in during implementation; UI/UX is a follow-up.
 */
const multiplayerPlugin: FramePlugin = {
  id: "multiplayer",
  version: "0.0.0",
  nav: [
    {
      id: "multiplayer",
      label: "Multiplayer",
      order: 25,
      items: [
        {
          id: "multiplayer.lobby",
          label: "Lobby",
          to: "/lobby",
          end: true,
          order: 0,
          icon: Swords,
        },
      ],
    },
  ],
  routes: [
    {
      path: "lobby",
      lazy: () => import("./pages/LobbyPage"),
      crumb: "Lobby",
    },
  ],
};

export default multiplayerPlugin;
