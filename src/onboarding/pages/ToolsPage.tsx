import { Trans } from "@lingui/react/macro";
import { FeatureToggles } from "@/general/FeatureToggles";

/**
 * Asks which making and developer tools to show, with the same switches as
 * General settings. A switch is written as it is flipped, so Continue and Skip
 * both leave what the player chose. Not asked when a distribution profile seeds
 * the toggles, because the distributor has already chosen.
 */
export default function ToolsPage() {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        <Trans>
          Optionally pick tools to turn on, these can be changed in settings if
          you change your mind.
        </Trans>
      </p>
      <FeatureToggles />
    </div>
  );
}
