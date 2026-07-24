import type { FramePlugin } from "@picoframe/plugin-sdk";
import { DeepLinkHandler } from "./DeepLinkHandler";

/**
 * The `coilbox://` deep-link plugin (issue #388). No nav, routes or settings of
 * its own: it contributes only an app-wide Provider that listens for inbound
 * links and confirms each one before acting. The Provider must sit inside the
 * router (picoframe mounts plugin Providers within its HashRouter) so it can
 * navigate to the target screen or importer.
 */
const deepLinkPlugin: FramePlugin = {
  id: "deeplink",
  version: "0.0.0",
  routes: [],
  Provider: DeepLinkHandler,
};

export default deepLinkPlugin;
