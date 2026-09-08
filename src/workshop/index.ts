import type { FramePlugin } from "@picoframe/plugin-sdk";
import { SlidersHorizontal } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";

/**
 * The workshop: changing what a game's units are, rather than what they look
 * like.
 *
 * v0.1 is the unit page: change a unit's numbers, and copy a unit to add one of
 * your own. Edits go into a named project as they are made, one project per
 * game, saved through the frame settings store and exportable as a `.json`
 * anybody can open (issue #1282, and `project.ts`). Asset pickers follow.
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
      // The game and the unit are query parameters rather than path segments,
      // so picking either does not unmount the page and take the unsaved edits
      // with it. See the page's own note.
      path: "workshop",
      lazy: gateAdvanced(() => import("./pages/UnitPage")),
      crumb: "Unit tweaks",
    },
  ],
  settings: [],
};

export default workshopPlugin;
