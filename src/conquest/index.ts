import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Orbit } from "lucide-react";
import { useContentState } from "../content/config";
import { getCachedGalaxy } from "./conquests";

/**
 * The Galactic Conquest plugin's frontend half — a single-player strategy
 * layer where winning skirmishes captures territory on a 3D galaxy map.
 * Galaxy documents and run state are stored by the
 * `tauri-plugin-coilbox-conquest` crate (ACL id `coilbox-conquest`); the
 * schema lives in `model.ts`, the pure rules in `rules.ts`.
 *
 * The Conquest item joins the existing **Play** group (nav groups merge by
 * id). Unlike Campaigns it shows whenever a game is installed — the
 * procedural generator means conquest works for any game with skirmish AIs,
 * so it should be discoverable before any galaxy exists.
 */

/** Nav gate: visible once the content state reports at least one game. */
function useConquestVisible(): boolean {
  const { state } = useContentState();
  return (state?.roots ?? []).some((r) => r.counts.games > 0);
}

const conquestPlugin: FramePlugin = {
  id: "conquest",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "conquest.list",
          label: "Conquest",
          to: "/conquest",
          order: 2,
          icon: Orbit,
          useVisible: useConquestVisible,
        },
      ],
    },
  ],
  routes: [
    {
      path: "conquest",
      lazy: () => import("./pages/ConquestListPage"),
      crumb: "Conquest",
    },
    {
      // The battle briefing lives on this page as an overlay (camera zooms to
      // the contested node) — there is no separate battle route.
      path: "conquest/:id",
      lazy: () => import("./pages/GalaxyPage"),
      crumb: (c) =>
        (c.params.id && getCachedGalaxy(c.params.id)?.galaxy.title) || "Galaxy",
    },
  ],
};

export default conquestPlugin;
