import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  AtSign,
  BarChart3,
  Crosshair,
  Gamepad2,
  LogIn,
  MessagesSquare,
  Swords,
  Users,
  UserX,
} from "lucide-react";
import { isProfileHidden } from "../profile/hidden";
import LobbyStatusButton from "./LobbyStatusButton";
import { BattleNavBadge, ChatNavBadge } from "./nav/navBadges";
import HighlightsSettings from "./pages/HighlightsSettings";
import IgnoreSettings from "./pages/IgnoreSettings";
import {
  MultiplayerProvider,
  useBattleRoomLabel,
  useMpDisconnected,
  useMpInBattle,
  useMpMatchmaking,
  useMpRevealed,
} from "./store";

/**
 * The multiplayer plugin's frontend half: a "Lobby" nav group and its routes,
 * backed by the `tauri-plugin-coilbox-multiplayer` crate (ACL id
 * `coilbox-multiplayer`). Connection state / mirror store and the battle-list, chat
 * and battle-room pages are filled in during implementation; UI/UX is a follow-up.
 *
 * "Player stats" (list + player dossier) moved here from Content in #467, renamed
 * from "Stats"; the pages themselves still live in `content/pages` (built on the
 * content plugin's local replay-stats database) — only the nav item and route
 * registration moved.
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
          // Unread DMs + highlight-word hits (issue #273).
          badge: () => <ChatNavBadge />,
        },
        {
          id: "multiplayer.battles",
          label: "Battles",
          to: "/battles",
          end: true,
          order: 2,
          icon: Swords,
          // Not gated on having connected: a direct room is hosted from this page
          // with no server and no login, so gating it on a login would put the
          // one entry point to serverless hosting behind the servers being up
          // (issue #1580). A distribution profile can still hide it.
          useVisible: () => !isProfileHidden("multiplayer.battles"),
        },
        {
          id: "multiplayer.matchmaking",
          label: "Matchmaking",
          to: "/matchmaking",
          end: true,
          order: 3,
          icon: Crosshair,
          // Tachyon only, because TASServer has no matchmaking at all.
          useVisible: useMpMatchmaking,
        },
        {
          id: "multiplayer.battle",
          // Static fallback; the live battle title comes from `useLabel`.
          label: "Battle Room",
          to: "/battle",
          end: true,
          order: 4,
          icon: Gamepad2,
          // Only while in a battle; label tracks the joined battle's title.
          useVisible: useMpInBattle,
          useLabel: useBattleRoomLabel,
          // Unread battle chat + a status dot when the game is running (#273).
          badge: () => <BattleNavBadge />,
        },
        {
          id: "multiplayer.stats",
          label: "Player stats",
          to: "/stats",
          order: 5,
          icon: BarChart3,
          // A distribution profile can hide the stats view like any other nav item.
          useVisible: () => !isProfileHidden("multiplayer.stats"),
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
      path: "matchmaking",
      lazy: () => import("./pages/MatchmakingPage"),
      crumb: "Matchmaking",
    },
    {
      path: "chatlogs",
      lazy: () => import("./pages/ChatLogPage"),
      crumb: "Chat logs",
    },
    {
      path: "stats",
      lazy: () => import("../content/pages/StatsPage"),
      crumb: "Player stats",
    },
    {
      path: "stats/:name",
      lazy: () => import("../content/pages/PlayerDossierPage"),
      crumb: (c) => c.params.name ?? "Player",
    },
    {
      path: "battle",
      lazy: () => import("./pages/BattleRoomPage"),
      crumb: "Battle Room",
    },
  ],
  settings: [
    // The group the three multiplayer sections hang off. Declared here because
    // this plugin owns two of them. `lobby-servers` is its own plugin and joins
    // by naming this id as its parent.
    {
      id: "multiplayer",
      title: "Multiplayer",
      description: "The servers you play on, and who you hear from there.",
      order: 70,
      icon: Users,
    },
    {
      id: "chat-highlights",
      title: "Chat highlights",
      description: "Words that light up a chat tab when somebody says them.",
      parent: "multiplayer",
      order: 20,
      icon: AtSign,
      Component: HighlightsSettings,
    },
    {
      id: "ignored-users",
      title: "Ignored users",
      description: "People whose messages coilbox hides from you.",
      parent: "multiplayer",
      order: 30,
      icon: UserX,
      Component: IgnoreSettings,
    },
  ],
  slots: [{ slot: "topbar.right", order: 100, Component: LobbyStatusButton }],
  // App-level: the live connection + its state mirror must outlive the Lobby route
  // so navigating away doesn't drop the UI's view of a still-open connection.
  Provider: MultiplayerProvider,
};

export default multiplayerPlugin;
