import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Binary, BookOpen, Code2, FileCode2, ScrollText } from "lucide-react";

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
        // External references — shown on the home launcher only (sidebar: false),
        // opened in the system browser via the Tauri opener.
        {
          id: "animation.guide-skeletor-ik",
          label: "Skeletor IK Animation Guide",
          href: "https://docs.google.com/document/d/1-oMLkWHBhfN6a3a5aEZU6X02lY4aZE52nZRtrvIe4cM/edit?tab=t.0#heading=h.ria8yldeo799",
          icon: BookOpen,
          sidebar: false,
          order: 2,
        },
        {
          id: "animation.skeletor-s3o",
          label: "Skeletor S3O",
          href: "https://github.com/Beherith/Skeletor_S3O",
          icon: Code2,
          sidebar: false,
          order: 3,
        },
        {
          id: "animation.lua-animations",
          label: "Lua Animations",
          href: "https://springrts.com/wiki/Animation-LuaScripting",
          icon: ScrollText,
          sidebar: false,
          order: 4,
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
