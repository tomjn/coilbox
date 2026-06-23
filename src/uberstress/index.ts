import type { FramePlugin } from "@picoframe/plugin-sdk";
import { History, Server, Zap } from "lucide-react";

/**
 * The uberstress plugin's frontend half. Contributes a nav group and three lazy
 * routes: Run (drive a load/bench test with live progress), History (browse past
 * runs with graphs), and Servers (manage the lobby-server list + bench config).
 * Pair it with the `tauri-plugin-coilbox-uberstress` crate (ACL id
 * `coilbox-uberstress`).
 */
const uberstressPlugin: FramePlugin = {
  id: "uberstress",
  version: "0.0.0",
  nav: [
    {
      id: "uberstress",
      label: "uberstress",
      order: 30,
      items: [
        { id: "uberstress.run", label: "Run", to: "/uberstress", end: true, order: 0, icon: Zap },
        { id: "uberstress.history", label: "History", to: "/uberstress/history", order: 1, icon: History },
        { id: "uberstress.servers", label: "Servers", to: "/uberstress/servers", order: 2, icon: Server },
      ],
    },
  ],
  routes: [
    { path: "uberstress", lazy: () => import("./pages/RunPage"), crumb: "uberstress" },
    { path: "uberstress/history", lazy: () => import("./pages/HistoryPage"), crumb: "History" },
    { path: "uberstress/servers", lazy: () => import("./pages/ServersPage"), crumb: "Servers" },
  ],
};

export default uberstressPlugin;
