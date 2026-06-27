import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Boxes, FolderTree } from "lucide-react";
import EnginesSection from "./pages/EnginesSection";
import FoldersSection from "./pages/FoldersSection";

/**
 * The content plugin's frontend half. In phase 1 it contributes two settings
 * sections — Content Folders (Spring/Recoil data roots, auto-detected + added
 * manually, with detection prefs) and Engines (engine installs found within
 * them) — hosted at `/settings/content-folders` and `/settings/engines`. These
 * are configuration-shaped today; once map/game browsing lands they move to
 * first-class sidebar routes. Pair with the `tauri-plugin-coilbox-content` crate
 * (ACL id `coilbox-content`), whose persisted state.json is the cross-plugin
 * read API for where game content lives.
 *
 * Settings Components are imported eagerly (not lazy): the frame settings page
 * renders them directly without a Suspense boundary, so React.lazy can't be used.
 */
const contentPlugin: FramePlugin = {
  id: "content",
  version: "0.0.0",
  nav: [],
  routes: [],
  settings: [
    {
      id: "content-folders",
      title: "Content Folders",
      icon: FolderTree,
      Component: FoldersSection,
    },
    {
      id: "engines",
      title: "Engines",
      icon: Boxes,
      Component: EnginesSection,
    },
  ],
};

export default contentPlugin;
