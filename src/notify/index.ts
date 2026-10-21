import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Bell } from "lucide-react";
import { lazyText } from "../i18n/pluginText";
import NotificationsBell from "./NotificationsBell";
import NotificationsSettings from "./NotificationsSettings";
import { NotifyProvider } from "./NotifyProvider";

/**
 * Frame-level notifications plugin. Mounts the app-wide sonner toast host,
 * contributes a topbar history bell (recent notifications survive the toast
 * vanishing) and a "Notifications" settings section (OS toggle + permission
 * grant + test). Notification triggers live at their event sources and call the
 * imperative `notify()` helper directly; that helper records each one into the
 * bell's history at a single interception point.
 */
const notifyPlugin: FramePlugin = {
  id: "notify",
  version: "0.0.0",
  routes: [],
  Provider: NotifyProvider,
  slots: [{ slot: "topbar.right", order: 3, Component: NotificationsBell }],
  settings: [
    {
      id: "notifications",
      title: lazyText(msg`Notifications`),
      order: 30,
      icon: Bell,
      Component: NotificationsSettings,
    },
  ],
};

export default notifyPlugin;
