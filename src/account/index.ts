import type { FramePlugin } from "@picoframe/plugin-sdk";
import { UserCog } from "lucide-react";
import AccountSettings from "./pages/SettingsSection";

/**
 * Account management for the one lobby account currently signed in: its details,
 * its password, its email address and its verification code. Separate from the
 * lobby-servers section, which owns the local list of servers and logins, because
 * everything here goes to the server and can fail there.
 */
const accountPlugin: FramePlugin = {
  id: "account",
  version: "0.0.0",
  routes: [],
  settings: [
    {
      id: "account",
      title: "Account",
      description: "The lobby account you are signed in to.",
      parent: "multiplayer",
      order: 40,
      icon: UserCog,
      Component: AccountSettings,
    },
  ],
};

export default accountPlugin;
