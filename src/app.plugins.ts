import { type FramePlugin, framePlugin } from "@picoframe/frame";
import animationPlugin from "./animation";
import contentPlugin from "./content";
// picoframe:imports-start
import downloadsPlugin from "./downloads";
import mapconvPlugin from "./mapconv";
import uberstressPlugin from "./uberstress";
// picoframe:imports-end

/** The app's plugin list. `picoframe add <plugin>` edits this file. */
export const plugins: FramePlugin[] = [
  framePlugin,
  // picoframe:plugins-start
  downloadsPlugin,
  uberstressPlugin,
  mapconvPlugin,
  animationPlugin,
  contentPlugin,
  // picoframe:plugins-end
];
