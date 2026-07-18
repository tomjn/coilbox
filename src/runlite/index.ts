import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Swords } from "lucide-react";

/**
 * The single-player roguelite Run plugin's frontend half — a forward-only node
 * graph crossed once on top of the conquest battle engine. The active run and
 * persistent meta-progression are stored by the `tauri-plugin-coilbox-runlite`
 * crate (ACL id `coilbox-runlite`); the schema lives in `model.ts`, the pure
 * generator in `generate.ts`, the pure transitions in `progress.ts`.
 *
 * The Run item joins the existing **Play** group (nav groups merge by id),
 * always visible for the same reason conquest is: the procedural generator works
 * for any game with skirmish AIs, and availability is a unitsync question the
 * page answers itself.
 */
const runlitePlugin: FramePlugin = {
  id: "runlite",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "runlite.list",
          label: "Run",
          to: "/runlite",
          order: 3,
          icon: Swords,
        },
      ],
    },
  ],
  routes: [
    {
      path: "runlite",
      lazy: () => import("./pages/RunListPage"),
      crumb: "Run",
    },
    {
      path: "runlite/active",
      lazy: () => import("./pages/RunPage"),
      crumb: "Active run",
    },
  ],
};

export default runlitePlugin;
