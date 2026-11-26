import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import {
  BookOpen,
  Hammer,
  LayoutGrid,
  Map as MapIcon,
  PackageOpen,
} from "lucide-react";
import { featureVisible, gateFeature } from "../general/features";
import { lazyText } from "../i18n/pluginText";
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
      label: lazyText(msg`Mapping tools`),
      order: 40,
      items: [
        {
          id: "mapconv.projects",
          label: lazyText(msg`Projects`),
          to: "/mapconv/projects",
          order: 0,
          icon: LayoutGrid,
          useVisible: featureVisible("mapping"),
        },
        {
          id: "mapconv.compile",
          label: lazyText(msg`Compile`),
          to: "/mapconv",
          end: true,
          order: 1,
          icon: Hammer,
          useVisible: featureVisible("mapping"),
        },
        {
          id: "mapconv.decompile",
          label: lazyText(msg`Decompile`),
          to: "/mapconv/decompile",
          order: 2,
          icon: PackageOpen,
          useVisible: featureVisible("mapping"),
        },
        // External reference — home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener.
        {
          id: "mapconv.mapping-wiki",
          label: lazyText(msg`Mapping wiki`),
          href: "https://springrts.com/wiki/Mapdev:Main",
          icon: BookOpen,
          sidebar: false,
          order: 3,
          useVisible: featureVisible("mapping"),
        },
      ],
    },
  ],
  routes: [
    {
      path: "mapconv/projects",
      lazy: gateFeature("mapping", () => import("./pages/ProjectsPage")),
      crumb: lazyText(msg`Projects`),
    },
    {
      path: "mapconv",
      lazy: gateFeature("mapping", () => import("./pages/CompilePage")),
      crumb: lazyText(msg`mapconv`),
    },
    {
      path: "mapconv/decompile",
      lazy: gateFeature("mapping", () => import("./pages/DecompilePage")),
      crumb: lazyText(msg`Decompile`),
    },
  ],
  settings: [
    {
      id: "mapconv",
      title: lazyText(msg`Map compiler`),
      description: lazyText(msg`Builds maps and takes them apart.`),
      parent: "advanced",
      order: 10,
      icon: MapIcon,
      Component: MapconvSettings,
    },
  ],
};

export default mapconvPlugin;
