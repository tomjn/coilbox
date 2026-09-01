import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Blocks, Boxes, Code2 } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import CoilMark from "../general/CoilMark";

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
          label: "Units",
          to: "/lego",
          end: true,
          order: 0,
          icon: Boxes,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.parts",
          label: "Lego Parts",
          to: "/lego/parts",
          order: 1,
          icon: Blocks,
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
      crumb: "Units",
    },
    {
      path: "lego/parts",
      lazy: gateAdvanced(() => import("./pages/PartsPage")),
      crumb: "Lego Parts",
    },
    {
      // Before the unit route so the two are read in the order they are
      // written, though a static segment outranks a dynamic one either way.
      path: "lego/open",
      lazy: gateAdvanced(() => import("./pages/OpenFromArchivePage")),
      crumb: "Open a model",
    },
    {
      path: "lego/:id",
      lazy: gateAdvanced(() => import("./pages/BuilderPage")),
      crumb: "Unit",
    },
  ],
  settings: [],
};

export default legoPlugin;
