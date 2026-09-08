import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Boxes, Code2, ToyBrick } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import CoilMark from "../general/CoilMark";
import { insideSection } from "../general/nav";
import { getCachedProject } from "./projects";

/**
 * The unit builder: assemble Spring/Recoil units from a library of pre-textured
 * parts, the way Splinter Faction and Evolution RTS build theirs.
 *
 * v0.1 ships the parts browser. The project overview, the 3D assembler and s3o
 * export follow.
 */
const legoPlugin: FramePlugin = {
  id: "lego",
  version: "0.0.0",
  nav: [
    {
      id: "lego",
      label: "unit builder",
      order: 45,
      items: [
        {
          id: "lego.units",
          label: "Models",
          to: "/lego",
          // Lit on the list and on a model you have open, but not on Lego
          // Parts, which is the item below's (issue #2719).
          end: true,
          activeWhen: insideSection("/lego", ["/lego/parts"]),
          order: 0,
          icon: Boxes,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.parts",
          label: "Lego Parts",
          to: "/lego/parts",
          order: 1,
          icon: ToyBrick,
          useVisible: useAdvancedMode,
        },
        // External references, home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener.
        {
          id: "lego.builder-guide",
          label: "Unit builder guide",
          href: "https://tomjn.github.io/coilbox/lego-builder",
          icon: CoilMark,
          sidebar: false,
          order: 2,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.parts-pack-guide",
          label: "Parts pack format",
          href: "https://tomjn.github.io/coilbox/lego-parts-pack",
          icon: CoilMark,
          sidebar: false,
          order: 3,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.s3o-format",
          label: "s3o format",
          href: "https://tomjn.github.io/coilbox/s3o-format",
          icon: CoilMark,
          sidebar: false,
          order: 4,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.s3o-blender-tools",
          label: "S3O Blender Tools",
          href: "https://github.com/ChrisFloofyKitsune/s3o-blender-tools/",
          icon: Code2,
          sidebar: false,
          order: 5,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "lego",
      lazy: gateAdvanced(() => import("./pages/ProjectsPage")),
      crumb: "Models",
    },
    {
      path: "lego/parts",
      lazy: gateAdvanced(() => import("./pages/PartsPage")),
      crumb: "Lego Parts",
    },
    {
      // Before the model route so the two are read in the order they are
      // written, though a static segment outranks a dynamic one either way.
      path: "lego/open",
      lazy: gateAdvanced(() => import("./pages/OpenFromArchivePage")),
      crumb: "Open a model",
    },
    {
      // The route param is an opaque uuid, so the crumb resolves the model's
      // name from the session cache, falling back when the list has not loaded.
      path: "lego/:id",
      lazy: gateAdvanced(() => import("./pages/BuilderPage")),
      crumb: (c) =>
        (c.params.id && getCachedProject(c.params.id)?.name) || "Model",
    },
  ],
  settings: [],
};

export default legoPlugin;
