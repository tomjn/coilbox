import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Binary, FileCode2 } from "lucide-react";

/**
 * The animation plugin: tools for Spring/Recoil unit-script animation. v0.4
 * ships a client-side BOS → Lua converter (a port of CarRepairer's bos2lua) and
 * a BOS → COB compiler + COB disassembler (Rust crate `coilbox-anim`, a
 * byte-exact port of BARScriptCompiler).
 */
const animationPlugin: FramePlugin = {
  id: "animation",
  version: "0.0.0",
  nav: [
    {
      id: "animation",
      label: "animation",
      order: 50,
      items: [
        {
          id: "animation.bos2lua",
          label: "BOS → Lua",
          to: "/animation",
          end: true,
          order: 0,
          icon: FileCode2,
        },
        {
          id: "animation.cob",
          label: "COB tools",
          to: "/animation/cob",
          order: 1,
          icon: Binary,
        },
      ],
    },
  ],
  routes: [
    {
      path: "animation",
      lazy: () => import("./pages/Bos2LuaPage"),
      crumb: "Animation",
    },
    {
      path: "animation/cob",
      lazy: () => import("./pages/CobPage"),
      crumb: "COB tools",
    },
  ],
  settings: [],
};

export default animationPlugin;
