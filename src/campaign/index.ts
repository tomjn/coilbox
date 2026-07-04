import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Milestone } from "lucide-react";

/**
 * The Campaigns plugin's frontend half — a player-facing **Campaigns** sidebar
 * section listing authored sequences of skirmish missions. Campaign documents,
 * imported panorama art and player progress are stored by the
 * `tauri-plugin-coilbox-campaign` crate (ACL id `coilbox-campaign`); the schema
 * lives in `model.ts`. This phase ships the data layer plus a placeholder list
 * page — the builder UI and mission-by-mission play flow come in later phases.
 */
const campaignPlugin: FramePlugin = {
  id: "campaign",
  version: "0.0.0",
  nav: [
    {
      id: "campaign",
      label: "Campaigns",
      order: 6,
      items: [
        {
          id: "campaign.list",
          label: "Campaigns",
          to: "/campaign",
          order: 0,
          icon: Milestone,
        },
      ],
    },
  ],
  routes: [
    {
      path: "campaign",
      lazy: () => import("./pages/CampaignsPage"),
      crumb: "Campaigns",
    },
  ],
};

export default campaignPlugin;
