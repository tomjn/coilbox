import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Award } from "lucide-react";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";

/**
 * The Career plugin's frontend half: one page under **Play** that shows how far
 * the player has got in each game, across campaigns, Conquest, Warpath and
 * skirmishes against AI. It reads those stores and keeps none of its own, so it
 * has no backend crate and no ACL entry.
 *
 * A distribution can hide it like Conquest or Warpath, by `career.overview` in
 * the profile's `hide` list.
 */
const careerPlugin: FramePlugin = {
  id: "career",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "career.overview",
          label: "Career",
          to: "/career",
          // After Warpath (3), before Replays (4).
          order: 3.5,
          icon: Award,
          useVisible: () => !isProfileHidden("career.overview"),
        },
      ],
    },
  ],
  routes: [
    {
      path: "career",
      lazy: gateProfileHidden(
        "career.overview",
        () => import("./pages/CareerPage"),
      ),
      crumb: "Career",
    },
  ],
};

export default careerPlugin;
