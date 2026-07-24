import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Orbit } from "lucide-react";
import { NeedsGameNavBadge } from "../play/navBadges";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import { getCachedGalaxy } from "./conquests";

/**
 * The Galactic Conquest plugin's frontend half — a single-player strategy
 * layer where winning skirmishes captures territory on a 3D galaxy map.
 * Galaxy documents and run state are stored by the
 * `tauri-plugin-coilbox-conquest` crate (ACL id `coilbox-conquest`); the
 * schema lives in `model.ts`, the pure rules in `rules.ts`.
 *
 * The Conquest item joins the existing **Play** group (nav groups merge by
 * id). It is always visible: the procedural generator means conquest works for
 * any game with skirmish AIs, and whether a game is actually available is a
 * unitsync question the page answers itself (with guidance when none is found).
 * A file-count nav gate would wrongly hide it for rapid installs, which land in
 * `packages/`+`pool/` rather than as an archive in `games/`. Per #419, it does
 * carry a "Needs a game" badge in that state — visible but not gated — via
 * `NeedsGameNavBadge`.
 */

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
          badge: NeedsGameNavBadge,
          // A distribution can hide Conquest entirely (issue #372).
          useVisible: () => !isProfileHidden("conquest.list"),
        },
      ],
    },
  ],
  routes: [
    {
      path: "conquest",
      lazy: gateProfileHidden(
        "conquest.list",
        () => import("./pages/ConquestListPage"),
      ),
      crumb: "Conquest",
    },
    {
      // The battle briefing lives on this page as an overlay (camera zooms to
      // the contested node). There is no separate battle route.
      path: "conquest/:id",
      lazy: gateProfileHidden(
        "conquest.list",
        () => import("./pages/GalaxyPage"),
      ),
      crumb: (c) =>
        (c.params.id && getCachedGalaxy(c.params.id)?.galaxy.title) || "Galaxy",
    },
  ],
};

export default conquestPlugin;
