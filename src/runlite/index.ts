import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Rocket } from "lucide-react";
import { NeedsGameNavBadge } from "../play/navBadges";
import { getCachedRun } from "./runs";

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
 * page answers itself. Per #419, it carries a "Needs a game" badge in that
 * state — visible but not gated — via `NeedsGameNavBadge`.
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
          label: "Warpath",
          to: "/warpath",
          order: 3,
          icon: Rocket,
          badge: NeedsGameNavBadge,
        },
      ],
    },
  ],
  routes: [
    {
      path: "warpath",
      lazy: () => import("./pages/RunListPage"),
      crumb: "Warpath",
    },
    {
      path: "warpath/:runId",
      lazy: () => import("./pages/RunPage"),
      crumb: (c) =>
        (c.params.runId && getCachedRun(c.params.runId)?.name) || "Warpath",
    },
  ],
};

export default runlitePlugin;
