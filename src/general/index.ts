import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Settings2, Wrench } from "lucide-react";
import { CloseDrawerOnNavigate } from "./drawer";
import { FullscreenControls } from "./fullscreen";
import GeneralSettings from "./pages/SettingsSection";
import { QuitControl } from "./quit";

/**
 * The general plugin: app-wide preferences with no routes/nav of its own, just a
 * "General" settings section (frame settings page at `/settings/general`). It
 * currently owns the Advanced-mode toggle; the predicate and route guard live in
 * `./advanced` and are imported by the plugins whose nav/routes it gates
 * (uberstress, mapconv, animation, and the content archive explorer).
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 *
 * Its `Provider` is app-wide behaviour with no settings of its own: closing the
 * frame's drawer on a navigation, which every drawer in the app needs.
 */
const generalPlugin: FramePlugin = {
  id: "general",
  version: "0.0.0",
  routes: [],
  Provider: CloseDrawerOnNavigate,
  slots: [
    { slot: "topbar.right", Component: FullscreenControls },
    { slot: "sidebar.footer", Component: QuitControl },
  ],
  settings: [
    {
      id: "general",
      title: "General",
      order: 0,
      icon: Settings2,
      Component: GeneralSettings,
    },
    // The bottom group, for the tooling a player never needs. Declared here
    // rather than in any one tool because no tool owns the others, and this
    // plugin already owns the Advanced-mode toggle that gates their nav.
    {
      id: "advanced",
      title: "Advanced",
      order: 90,
      icon: Wrench,
    },
  ],
};

export default generalPlugin;
