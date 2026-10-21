import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { ServerCog } from "lucide-react";
import { lazyText } from "../i18n/pluginText";
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
      title: lazyText(msg`Lobby servers`),
      description: lazyText(
        msg`The servers you can log in to, and your accounts on them.`,
      ),
      parent: "multiplayer",
      order: 10,
      icon: ServerCog,
      Component: LobbyServersSettings,
    },
  ],
};

export default lobbyServersPlugin;
