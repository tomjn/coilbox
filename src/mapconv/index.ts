import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  BookOpen,
  Hammer,
  LayoutGrid,
  Map as MapIcon,
  PackageOpen,
} from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
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
      // The group is the map making tools, of which mapconv is one. The id,
      // the routes and the settings section keep the tool's own name, because
      // that is what a distribution profile and the docs refer to.
      label: "Mapping Tools",
      order: 40,
      items: [
        {
          id: "mapconv.projects",
          label: "Projects",
          to: "/mapconv/projects",
          order: 0,
          icon: LayoutGrid,
          useVisible: useAdvancedMode,
        },
        {
          id: "mapconv.compile",
          label: "Compile",
          to: "/mapconv",
          end: true,
          order: 1,
          icon: Hammer,
          useVisible: useAdvancedMode,
        },
        {
          id: "mapconv.decompile",
          label: "Decompile",
          to: "/mapconv/decompile",
          order: 2,
          icon: PackageOpen,
          useVisible: useAdvancedMode,
        },
        // External reference — home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener.
        {
          id: "mapconv.mapping-wiki",
          label: "Mapping Wiki",
          href: "https://springrts.com/wiki/Mapdev:Main",
          icon: BookOpen,
          sidebar: false,
          order: 3,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "mapconv/projects",
      lazy: gateAdvanced(() => import("./pages/ProjectsPage")),
      crumb: "Projects",
    },
    {
      path: "mapconv",
      lazy: gateAdvanced(() => import("./pages/CompilePage")),
      crumb: "mapconv",
    },
    {
      path: "mapconv/decompile",
      lazy: gateAdvanced(() => import("./pages/DecompilePage")),
      crumb: "Decompile",
    },
  ],
  settings: [
    {
      id: "mapconv",
      title: "mapconv",
      description: "The map compiler coilbox builds and takes apart maps with.",
      parent: "advanced",
      order: 10,
      icon: MapIcon,
      Component: MapconvSettings,
    },
  ],
};

export default mapconvPlugin;
