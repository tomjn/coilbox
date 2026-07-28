import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Blocks, BookOpen } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";

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
          id: "lego.parts",
          label: "Lego Parts",
          to: "/lego/parts",
          order: 0,
          icon: Blocks,
          useVisible: useAdvancedMode,
        },
        {
          id: "lego.parts-pack-guide",
          label: "Parts pack format",
          href: "https://tomjn.github.io/coilbox/lego-parts-pack",
          icon: BookOpen,
          sidebar: false,
          order: 1,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "lego/parts",
      lazy: gateAdvanced(() => import("./pages/PartsPage")),
      crumb: "Lego Parts",
    },
  ],
  settings: [],
};

export default legoPlugin;
