import { FRAME_APPEARANCE_SETTINGS_ID } from "@picoframe/frame";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  Palette,
  ServerCog,
  Settings,
  Settings2,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import { isSettingsHidden } from "../profile/hidden";
import { FullscreenControls } from "./fullscreen";
import GeneralSettings from "./pages/SettingsSection";
import { QuitControl } from "./quit";
import { GeneralProvider } from "./uiZoom";

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
 * Its `Provider` is app-wide behaviour with no UI of its own: closing the
 * frame's drawer on a navigation, which every drawer in the app needs, and
 * holding the webview at the stored UI zoom.
 */
const generalPlugin: FramePlugin = {
  id: "general",
  version: "0.0.0",
  routes: [],
  // Settings had no way in from the welcome page and one gear in the sidebar
  // footer, which is the least visible corner of the window. The pages have
  // always been there, so this group is signposting rather than new screens.
  //
  // Declared here because no one plugin owns settings: the sections come from a
  // dozen plugins and the frame, and this one already declares the two groups
  // (General, Advanced) that belong to nobody else.
  //
  // Each item links to a settings section rather than a route of its own, so
  // there are no new routes and nothing to add to `docs/routes.md`.
  //
  // Welcome page only, via `sidebar: false` on every item. The sidebar already
  // had a way in and still does: the frame's footer gear, which carries the
  // settings badge this group has no way to show. Listing four more Settings
  // rows above a row already saying Settings was two answers to one question.
  // The welcome page is where the gap actually was.
  nav: [
    {
      id: "settings",
      label: "Settings",
      // Last. Everything above it is somewhere you go to do something, and this
      // is where you go to change how those behave.
      order: 60,
      items: [
        {
          // Second. Engine settings is the deepest of these and the one a
          // player reaches for least often, whatever its weight in the
          // settings tree.
          id: "settings.engine",
          label: "Engine settings",
          to: "/settings/engine-settings",
          order: 1,
          sidebar: false,
          icon: SlidersHorizontal,
          // Gated on the settings section rather than on a `hide` id of its
          // own. A distribution that hides the section wants the card gone too,
          // and one id cannot drift from the other.
          useVisible: () => !isSettingsHidden("engine-settings"),
        },
        {
          // First. The one people come here to change on day one, and the one
          // that needs no knowledge of Spring to want.
          id: "settings.appearance",
          label: "Appearance",
          to: `/settings/${FRAME_APPEARANCE_SETTINGS_ID}`,
          order: 0,
          sidebar: false,
          icon: Palette,
          useVisible: () => !isSettingsHidden(FRAME_APPEARANCE_SETTINGS_ID),
        },
        {
          // The lobby server logins, not the Coilbox hub sign-in. A player with
          // more than one account manages them here.
          id: "settings.accounts",
          label: "Accounts",
          to: "/settings/lobby-servers",
          order: 2,
          sidebar: false,
          icon: ServerCog,
          useVisible: () => !isSettingsHidden("lobby-servers"),
        },
        {
          // Everything else, including the sections this group does not name.
          id: "settings.all",
          label: "All settings",
          to: "/settings",
          order: 3,
          sidebar: false,
          icon: Settings,
        },
      ],
    },
  ],
  Provider: GeneralProvider,
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
      description:
        "Tools for making things, and for the people who ship coilbox.",
      order: 90,
      icon: Wrench,
    },
  ],
};

export default generalPlugin;
