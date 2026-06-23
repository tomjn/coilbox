import { type FramePlugin, framePlugin } from "@picoframe/frame";
// picoframe:imports-start
import prdownloaderPlugin from "./prdownloader";
import uberstressPlugin from "./uberstress";
// picoframe:imports-end

/** The app's plugin list. `picoframe add <plugin>` edits this file. */
export const plugins: FramePlugin[] = [
  framePlugin,
  // picoframe:plugins-start
  prdownloaderPlugin,
  uberstressPlugin,
  // picoframe:plugins-end
];
