import type { FramePlugin } from "@picoframe/plugin-sdk";
import { ServerCog } from "lucide-react";
import LobbyServersSettings from "./pages/SettingsSection";

/**
 * The lobby-servers plugin's frontend half: a single settings section owning the
 * shared lobby server directory + keychain-backed credentials, hosted at
 * `/settings/lobby-servers`. Paired with the `tauri-plugin-coilbox-lobby-servers`
 * crate (ACL id `coilbox-lobby-servers`).
 */
const lobbyServersPlugin: FramePlugin = {
  id: "lobby-servers",
  version: "0.0.0",
  routes: [],
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
