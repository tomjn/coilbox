import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Settings2 } from "lucide-react";
import { FullscreenControls } from "./fullscreen";
import GeneralSettings from "./pages/SettingsSection";

/**
 * The general plugin: app-wide preferences with no routes/nav of its own, just a
 * "General" settings section (frame settings page at `/settings/general`). It
 * currently owns the Advanced-mode toggle; the predicate and route guard live in
 * `./advanced` and are imported by the plugins whose nav/routes it gates
 * (uberstress, mapconv, animation, and the content archive explorer).
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const generalPlugin: FramePlugin = {
  id: "general",
  version: "0.0.0",
  routes: [],
  slots: [{ slot: "topbar.right", Component: FullscreenControls }],
  settings: [
    {
      id: "general",
      title: "General",
      order: 0,
      icon: Settings2,
      Component: GeneralSettings,
    },
  ],
};

export default generalPlugin;
