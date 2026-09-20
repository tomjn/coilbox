import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Volume2 } from "lucide-react";
import { SoundProvider } from "./SoundProvider";
import SoundSettings from "./SoundSettings";

/**
 * Frame-level sound plugin. Owns the shared audio context and the master gain
 * every cue routes through, and contributes the "Sound" settings section that
 * drives them. The cues themselves stay at their event sources (the lobby store
 * rings, mentions and in-game cues) and reach the graph through `src/sound/`.
 */
const soundPlugin: FramePlugin = {
  id: "sound",
  version: "0.0.0",
  routes: [],
  Provider: SoundProvider,
  settings: [
    {
      id: "sound",
      title: "Sound",
      // Between Notifications (30) and the Coilbox hub (40). Both are about
      // how the app gets your attention, so they sit together.
      order: 35,
      icon: Volume2,
      Component: SoundSettings,
    },
  ],
};

export default soundPlugin;
