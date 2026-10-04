import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Award } from "lucide-react";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
import { RECORDS_GROUP } from "../recordsGroup";

/**
 * The Career plugin's frontend half: one page under **Records** that shows how far
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
      ...RECORDS_GROUP,
      items: [
        {
          id: "career.overview",
          label: "Career",
          to: "/career",
          // First in Records: the summary, above Player stats and Replays.
          order: 0,
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
