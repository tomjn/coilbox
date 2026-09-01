import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Hammer, Milestone } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import CoilMark from "../general/CoilMark";
import { gateProfileHidden, isProfileHidden } from "../profile/hidden";
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
 * The builder joins the shared **Campaign Builder** group beside Scenarios,
 * visible only in advanced mode. Its routes are additionally
 * `gateAdvanced`-wrapped so a deep link isn't reachable while hidden.
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
      id: "builder",
      label: "Campaign Builder",
      order: 35,
      items: [
        {
          id: "campaign.builder",
          label: "Campaigns",
          to: "/campaign-builder",
          order: 1,
          icon: Hammer,
          // A distribution can also hide Campaign Builder outright (issue #372).
          useVisible: () =>
            useAdvancedMode() && !isProfileHidden("campaign.builder"),
        },
        // External reference, home launcher only (sidebar: false), opened in
        // the system browser via the Tauri opener.
        {
          id: "campaign.guide",
          label: "Campaigns guide",
          href: "https://tomjn.github.io/coilbox/campaigns",
          icon: CoilMark,
          sidebar: false,
          order: 3,
          useVisible: () =>
            useAdvancedMode() && !isProfileHidden("campaign.builder"),
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
      // A briefing is always full-bleed art with a card over it, and all three
      // things it can be are dark: an authored panorama, a lit 3D unit or map,
      // or the slate gradient the page falls back to. The scrim over them is the
      // page background, so on the light theme the art came out smeared white
      // (#1809 on a third screen). The campaign detail route above is not the
      // same case, since a campaign with no backdrop is an ordinary list page
      // and reads correctly on either theme.
      appearance: "dark",
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
      lazy: gateAdvanced(
        gateProfileHidden(
          "campaign.builder",
          () => import("./pages/CampaignBuilderPage"),
        ),
      ),
      crumb: "Campaign Builder",
    },
    {
      path: "campaign-builder/:id",
      lazy: gateAdvanced(
        gateProfileHidden(
          "campaign.builder",
          () => import("./pages/CampaignEditPage"),
        ),
      ),
      crumb: "Edit",
    },
  ],
};

export default campaignPlugin;
