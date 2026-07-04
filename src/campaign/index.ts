import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Hammer, Milestone } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { getCachedCampaign, useHasCampaigns } from "./campaigns";

/**
 * The Campaigns plugin's frontend half — a player-facing Campaigns list plus an
 * advanced-mode **Campaign Builder** for authoring sequences of skirmish missions.
 * Campaign documents, imported panorama art and player progress are stored by the
 * `tauri-plugin-coilbox-campaign` crate (ACL id `coilbox-campaign`); the schema
 * lives in `model.ts`.
 *
 * The player-facing Campaigns item joins the existing **Play** group (nav groups
 * merge by id) and is shown only once a campaign exists ({@link useHasCampaigns}).
 * The builder gets its own group like the other advanced tools (uberstress,
 * mapconv, animation), visible only in advanced mode — its routes are
 * additionally `gateAdvanced`-wrapped so a deep link isn't reachable while hidden.
 */
const campaignPlugin: FramePlugin = {
  id: "campaign",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "campaign.list",
          label: "Campaigns",
          to: "/campaign",
          order: 1,
          icon: Milestone,
          useVisible: useHasCampaigns,
        },
      ],
    },
    {
      id: "campaign-builder",
      label: "Campaign Builder",
      order: 35,
      items: [
        {
          id: "campaign.builder",
          label: "Builder",
          to: "/campaign-builder",
          order: 1,
          icon: Hammer,
          useVisible: useAdvancedMode,
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
    {
      // Crumbs resolve the campaign/mission *titles* from the session cache; the
      // route params are opaque UUIDs. A cache miss (deep link before the list has
      // loaded) falls back to a generic label.
      path: "campaign/:id",
      lazy: () => import("./pages/CampaignDetailPage"),
      crumb: (c) =>
        (c.params.id && getCachedCampaign(c.params.id)?.campaign.title) ||
        "Campaign",
    },
    {
      // No literal segment between the ids, so the breadcrumb trail is
      // Campaigns / <campaign> / <mission> with no phantom intermediate crumb.
      path: "campaign/:id/:missionId",
      lazy: () => import("./pages/MissionBriefingPage"),
      crumb: (c) => {
        const loaded = c.params.id ? getCachedCampaign(c.params.id) : undefined;
        const mission = loaded?.campaign.missions.find(
          (m) => m.id === c.params.missionId,
        );
        return mission?.title || "Mission";
      },
    },
    {
      path: "campaign-builder",
      lazy: gateAdvanced(() => import("./pages/CampaignBuilderPage")),
      crumb: "Campaign Builder",
    },
    {
      path: "campaign-builder/:id",
      lazy: gateAdvanced(() => import("./pages/CampaignEditPage")),
      crumb: "Edit",
    },
  ],
};

export default campaignPlugin;
