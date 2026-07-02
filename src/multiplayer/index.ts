import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Swords } from "lucide-react";
import { MultiplayerProvider } from "./store";

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
      // Directly under Singleplayer (play = 5), above Content (15).
      order: 10,
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
  // App-level: the live connection + its state mirror must outlive the Lobby route
  // so navigating away doesn't drop the UI's view of a still-open connection.
  Provider: MultiplayerProvider,
};

export default multiplayerPlugin;
