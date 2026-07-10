import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Bell } from "lucide-react";
import NotificationsSettings from "./NotificationsSettings";
import { NotifyProvider } from "./NotifyProvider";

/**
 * Frame-level notifications plugin. Mounts the app-wide sonner toast host and
 * contributes a "Notifications" settings section (OS toggle + permission grant +
 * test). Notification triggers live at their event sources and call the
 * imperative `notify()` helper directly.
 */
const notifyPlugin: FramePlugin = {
  id: "notify",
  version: "0.0.0",
  routes: [],
  Provider: NotifyProvider,
  settings: [
    {
      id: "notifications",
      title: "Notifications",
      icon: Bell,
      Component: NotificationsSettings,
    },
  ],
};

export default notifyPlugin;
