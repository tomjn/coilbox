import type { FramePlugin } from "@picoframe/plugin-sdk";
import { SlidersHorizontal } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { cachedProjectName } from "./project";

/**
 * The workshop: changing what a game's units are, rather than what they look
 * like.
 *
 * Two routes, the same pair the unit builder has: `/workshop` is the projects
 * you have started and `/workshop/:id` is one of them open (issue #2696). A
 * project is one game's edits, saved through the frame settings store as they
 * are made and exportable as a `.json` anybody can open (issue #1282, and
 * `project.ts`).
 */
const workshopPlugin: FramePlugin = {
  id: "workshop",
  version: "0.0.0",
  nav: [
    {
      id: "workshop",
      label: "workshop",
      order: 46,
      items: [
        {
          id: "workshop.units",
          label: "Unit tweaks",
          to: "/workshop",
          end: true,
          order: 0,
          icon: SlidersHorizontal,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "workshop",
      lazy: gateAdvanced(() => import("./pages/ProjectsPage")),
      crumb: "Unit tweaks",
    },
    {
      // The unit is a query parameter rather than a path segment, so picking one
      // does not unmount the page and take the game's whole unit table with it.
      // See the page's own note.
      //
      // The route param is an opaque uuid, so the crumb resolves the project's
      // name from the settings store, falling back when it names no project.
      // `new` is the editor with no project yet, which is where a unit's
      // encyclopedia page sends somebody who has picked a unit and not a
      // project (see `routes.ts`).
      path: "workshop/:id",
      lazy: gateAdvanced(() => import("./pages/UnitPage")),
      crumb: (c) =>
        c.params.id === "new"
          ? "New project"
          : (c.params.id && cachedProjectName(c.params.id)) || "Project",
    },
  ],
  settings: [],
};

export default workshopPlugin;
