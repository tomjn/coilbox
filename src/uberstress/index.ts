import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { History, Server, Zap } from "lucide-react";
import { featureVisible, gateFeature } from "../general/features";
import { lazyText } from "../i18n/pluginText";
import UberstressSettings from "./pages/SettingsSection";

/**
 * The uberstress plugin's frontend half. Contributes a nav group with two lazy
 * routes — Run (drive a load/bench test with live progress) and History (browse
 * past runs with graphs) — plus a settings section (server list + run defaults +
 * bench/DB config) hosted in the frame settings page at `/settings/uberstress`.
 * Pair it with the `tauri-plugin-coilbox-uberstress` crate (ACL id
 * `coilbox-uberstress`).
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const uberstressPlugin: FramePlugin = {
  id: "uberstress",
  version: "0.0.0",
  nav: [
    {
      id: "uberstress",
      label: lazyText(msg`uberstress`),
      order: 30,
      items: [
        {
          id: "uberstress.run",
          label: lazyText(msg`Run`),
          to: "/uberstress",
          end: true,
          order: 0,
          icon: Zap,
          useVisible: featureVisible("uberstress"),
        },
        {
          id: "uberstress.history",
          label: lazyText(msg`History`),
          to: "/uberstress/history",
          order: 1,
          icon: History,
          useVisible: featureVisible("uberstress"),
        },
      ],
    },
  ],
  routes: [
    {
      path: "uberstress",
      lazy: gateFeature("uberstress", () => import("./pages/RunPage")),
      crumb: lazyText(msg`uberstress`),
    },
    {
      path: "uberstress/history",
      lazy: gateFeature("uberstress", () => import("./pages/HistoryPage")),
      crumb: lazyText(msg`History`),
    },
  ],
  settings: [
    {
      id: "uberstress",
      title: lazyText(msg`uberstress`),
      description: lazyText(msg`A load tester for uberserver lobby servers.`),
      parent: "advanced",
      order: 20,
      icon: Server,
      Component: UberstressSettings,
    },
  ],
};

export default uberstressPlugin;
