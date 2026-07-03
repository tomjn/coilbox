import type { FramePlugin } from "@picoframe/plugin-sdk";
import { ServerCog } from "lucide-react";
import { LobbyServersProvider } from "./LobbyServersProvider";
import LobbyServersSettings from "./pages/SettingsSection";

/**
 * The lobby-servers plugin's frontend half: a settings section owning the server
 * catalog + accounts + keychain-backed credentials (`/settings/lobby-servers`), and
 * an app-level Provider that runs the one-time directory→accounts migration. Paired
 * with the `tauri-plugin-coilbox-lobby-servers` crate (ACL id `coilbox-lobby-servers`).
 */
const lobbyServersPlugin: FramePlugin = {
  id: "lobby-servers",
  version: "0.0.0",
  routes: [],
  Provider: LobbyServersProvider,
  settings: [
    {
      id: "lobby-servers",
      title: "Lobby servers",
      icon: ServerCog,
      Component: LobbyServersSettings,
    },
  ],
};

export default lobbyServersPlugin;
