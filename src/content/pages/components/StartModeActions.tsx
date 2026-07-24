import { Button } from "@picoframe/frame";
import { Milestone, Orbit, Rocket } from "lucide-react";
import { useNavigate } from "react-router";
import { useAdvancedMode } from "../../../general/advanced";
import { isProfileHidden } from "../../../profile/hidden";

/**
 * Game detail's cross-mode launch row (issue #372): "Start a conquest",
 * "Start a warpath run" and "New campaign" each navigate to that mode's setup
 * with this game preselected via a one-shot `?game=` query param (see
 * `useGamePresetParam`). Each action is hidden when the distribution profile
 * hides that mode's own nav item, matching the sidebar. Campaign creation is
 * also advanced-mode gated, like the Campaign Builder nav item itself.
 */
export function StartModeActions({ gameName }: { gameName: string }) {
  const navigate = useNavigate();
  const advanced = useAdvancedMode();

  const showConquest = !isProfileHidden("conquest.list");
  const showWarpath = !isProfileHidden("runlite.list");
  const showCampaign = advanced && !isProfileHidden("campaign.builder");

  if (!showConquest && !showWarpath && !showCampaign) return null;

  const withGame = (path: string) =>
    `${path}?game=${encodeURIComponent(gameName)}`;

  return (
    <div className="flex flex-wrap gap-2">
      {showConquest && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => navigate(withGame("/conquest"))}
        >
          <Orbit className="size-4" /> Start a conquest
        </Button>
      )}
      {showWarpath && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => navigate(withGame("/warpath"))}
        >
          <Rocket className="size-4" /> Start a warpath run
        </Button>
      )}
      {showCampaign && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => navigate(withGame("/campaign-builder"))}
        >
          <Milestone className="size-4" /> New campaign
        </Button>
      )}
    </div>
  );
}
