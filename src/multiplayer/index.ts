import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Gamepad2, LogIn, MessagesSquare, Swords } from "lucide-react";
import LobbyStatusButton from "./LobbyStatusButton";
import {
  MultiplayerProvider,
  useBattleRoomLabel,
  useMpDisconnected,
  useMpInBattle,
  useMpRevealed,
} from "./store";

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
          label: "Login",
          to: "/lobby",
          end: true,
          order: 0,
          icon: LogIn,
          // Only while logged out; disappears once connected.
          useVisible: useMpDisconnected,
        },
        {
          id: "multiplayer.chat",
          label: "Chat",
          to: "/chat",
          end: true,
          order: 1,
          icon: MessagesSquare,
          // Revealed on first connect, then sticky for the session.
          useVisible: useMpRevealed,
        },
        {
          id: "multiplayer.battles",
          label: "Battles",
          to: "/battles",
          end: true,
          order: 2,
          icon: Swords,
          useVisible: useMpRevealed,
        },
        {
          id: "multiplayer.battle",
          // Static fallback; the live battle title comes from `useLabel`.
          label: "Battle Room",
          to: "/battle",
          end: true,
          order: 3,
          icon: Gamepad2,
          // Only while in a battle; label tracks the joined battle's title.
          useVisible: useMpInBattle,
          useLabel: useBattleRoomLabel,
        },
      ],
    },
  ],
  routes: [
    {
      path: "lobby",
      lazy: () => import("./pages/LobbyPage"),
      crumb: "Login",
    },
    {
      path: "chat",
      lazy: () => import("./pages/ChatPage"),
      crumb: "Chat",
    },
    {
      path: "battles",
      lazy: () => import("./pages/BattlesPage"),
      crumb: "Battles",
    },
    {
      path: "battle",
      lazy: () => import("./pages/BattleRoomPage"),
      crumb: "Battle Room",
    },
  ],
  slots: [{ slot: "topbar.right", order: 100, Component: LobbyStatusButton }],
  // App-level: the live connection + its state mirror must outlive the Lobby route
  // so navigating away doesn't drop the UI's view of a still-open connection.
  Provider: MultiplayerProvider,
};

export default multiplayerPlugin;
