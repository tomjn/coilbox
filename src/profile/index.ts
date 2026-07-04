import { FRAME_APPEARANCE_SETTINGS_ID } from "@picoframe/frame";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Package } from "lucide-react";
import { isSettingsHidden } from "./hidden";
import ProfileSettings from "./SettingsSection";

/**
 * The profile plugin: applies a bundler-supplied distribution profile (window
 * title, hidden nav, preset game filter, branded welcome, theme). The profile is
 * loaded in `main.tsx` before first render and consumed across the app via the
 * `./profile` module; this plugin contributes the read-only status settings section
 * (frame settings page at `/settings/profile`), plus a gate that lets the profile
 * hide the frame's built-in Appearance section. Pair it with the
 * `tauri-plugin-coilbox-profile` crate (ACL id `coilbox-profile`).
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const profilePlugin: FramePlugin = {
  id: "profile",
  version: "0.0.0",
  routes: [],
  settings: [
    {
      id: "profile",
      title: "Distribution profile",
      order: 90,
      icon: Package,
      Component: ProfileSettings,
    },
    {
      // Merges by id into the frame's built-in Appearance section (0.0.17+): a
      // section carrying only this id + useVisible gates the theme UI without
      // replacing it. Lets the profile hide it via `hideSettings`, e.g. when it
      // forces a fixed mode/accent. `applyProfileSettingsHiding` doesn't reach this
      // frame-owned section, so the gate is declared here directly.
      id: FRAME_APPEARANCE_SETTINGS_ID,
      title: "Appearance",
      useVisible: () => !isSettingsHidden(FRAME_APPEARANCE_SETTINGS_ID),
    },
  ],
};

export default profilePlugin;
