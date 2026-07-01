import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Download } from "lucide-react";
import UpdatesSettingsSection from "./pages/UpdatesSettingsSection";
import UpdateBadge from "./UpdateBadge";
import { UpdaterProvider } from "./UpdaterProvider";

/**
 * Frame-level updater plugin. Wraps the Tauri updater/process plugins to detect
 * and install new GitHub releases. Contributes a topbar "update available" pill
 * and an "Updates" settings section at /settings/updates. The Provider fires one
 * background check on launch (release builds only).
 */
const updaterPlugin: FramePlugin = {
  id: "updater",
  version: "0.0.0",
  routes: [],
  Provider: UpdaterProvider,
  slots: [{ slot: "topbar.right", order: 0, Component: UpdateBadge }],
  settings: [
    {
      id: "updates",
      title: "Updates",
      icon: Download,
      Component: UpdatesSettingsSection,
    },
  ],
};

export default updaterPlugin;
