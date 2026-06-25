import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Hammer, Map as MapIcon, PackageOpen } from "lucide-react";
import MapconvSettings from "./pages/SettingsSection";

/**
 * The mapconv plugin's frontend half. Contributes a nav group with two lazy
 * routes — Compile (build a `.smf`/`.smt` from source images) and Decompile
 * (extract source images from a `.smf`) — plus a settings section hosted at
 * `/settings/mapconv`. Pair it with the `tauri-plugin-coilbox-mapconv` crate
 * (ACL id `coilbox-mapconv`), which shells out to the bundled SpringMapConvNG
 * `mapcompile`/`mapdecompile` sidecars.
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const mapconvPlugin: FramePlugin = {
  id: "mapconv",
  version: "0.0.0",
  nav: [
    {
      id: "mapconv",
      label: "mapconv",
      order: 40,
      items: [
        {
          id: "mapconv.compile",
          label: "Compile",
          to: "/mapconv",
          end: true,
          order: 0,
          icon: Hammer,
        },
        {
          id: "mapconv.decompile",
          label: "Decompile",
          to: "/mapconv/decompile",
          order: 1,
          icon: PackageOpen,
        },
      ],
    },
  ],
  routes: [
    {
      path: "mapconv",
      lazy: () => import("./pages/CompilePage"),
      crumb: "mapconv",
    },
    {
      path: "mapconv/decompile",
      lazy: () => import("./pages/DecompilePage"),
      crumb: "Decompile",
    },
  ],
  settings: [
    {
      id: "mapconv",
      title: "mapconv",
      icon: MapIcon,
      Component: MapconvSettings,
    },
  ],
};

export default mapconvPlugin;
