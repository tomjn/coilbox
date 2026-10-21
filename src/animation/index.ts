import { msg } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Binary, BookOpen, Code2, FileCode2, ScrollText } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { lazyText } from "../i18n/pluginText";

/**
 * The animation plugin: tools for Spring/Recoil unit-script animation. It
 * ships a BOS → Lua converter (Rust crate `coilbox-bos2lua`) and a BOS → COB
 * compiler + COB disassembler (Rust crate `coilbox-anim`, a byte-exact port of
 * BARScriptCompiler).
 */
const animationPlugin: FramePlugin = {
  id: "animation",
  version: "0.0.0",
  nav: [
    {
      id: "animation",
      label: lazyText(msg`animation`),
      order: 50,
      items: [
        {
          id: "animation.bos2lua",
          label: lazyText(msg`BOS → Lua`),
          to: "/animation",
          end: true,
          order: 0,
          icon: FileCode2,
          useVisible: useAdvancedMode,
        },
        {
          id: "animation.cob",
          label: lazyText(msg`COB tools`),
          to: "/animation/cob",
          order: 1,
          icon: Binary,
          useVisible: useAdvancedMode,
        },
        // External references — shown on the home launcher only (sidebar: false),
        // opened in the system browser via the Tauri opener.
        {
          id: "animation.guide-skeletor-ik",
          label: lazyText(msg`Skeletor IK Animation Guide`),
          href: "https://docs.google.com/document/d/1-oMLkWHBhfN6a3a5aEZU6X02lY4aZE52nZRtrvIe4cM/edit?tab=t.0#heading=h.ria8yldeo799",
          icon: BookOpen,
          sidebar: false,
          order: 2,
          useVisible: useAdvancedMode,
        },
        {
          id: "animation.skeletor-s3o",
          label: lazyText(msg`Skeletor S3O`),
          href: "https://github.com/Beherith/Skeletor_S3O",
          icon: Code2,
          sidebar: false,
          order: 3,
          useVisible: useAdvancedMode,
        },
        {
          id: "animation.lua-animations",
          label: lazyText(msg`Lua Animations`),
          href: "https://springrts.com/wiki/Animation-LuaScripting",
          icon: ScrollText,
          sidebar: false,
          order: 4,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "animation",
      lazy: gateAdvanced(() => import("./pages/Bos2LuaPage")),
      crumb: lazyText(msg`Animation`),
    },
    {
      path: "animation/cob",
      lazy: gateAdvanced(() => import("./pages/CobPage")),
      crumb: lazyText(msg`COB tools`),
    },
  ],
  settings: [],
};

export default animationPlugin;
