import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Import as ImportIcon } from "lucide-react";
import { DeepLinkHandler } from "./DeepLinkHandler";
import ImportSection from "./pages/ImportSection";

/**
 * The `coilbox://` deep-link plugin (issue #388). It contributes an app-wide
 * Provider that listens for inbound links and confirms each one before acting.
 * The Provider must sit inside the router (picoframe mounts plugin Providers
 * within its HashRouter) so it can navigate to the target screen or importer.
 *
 * It also owns the one import box (issue #1333), the manual half of the same
 * job: a link that never reaches the OS, because the scheme has no registered
 * handler, can be pasted in instead.
 *
 * The box is a settings section at `/settings/import` rather than a sidebar
 * item. Importing a shared thing is a rare, one-off act, and the sidebar is
 * where you go to do the thing you came for. When coilbox grows a hub screen of
 * its own, the box belongs there and this stops being the front door.
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary.
 */
const deepLinkPlugin: FramePlugin = {
  id: "deeplink",
  version: "0.0.0",
  routes: [],
  Provider: DeepLinkHandler,
  settings: [
    {
      id: "import",
      title: "Import",
      icon: ImportIcon,
      Component: ImportSection,
    },
  ],
};

export default deepLinkPlugin;
