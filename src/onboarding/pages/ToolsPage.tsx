import { FeatureToggles } from "@/general/FeatureToggles";

/**
 * Asks which making and developer tools to show, with the same switches as
 * General settings. A switch is written as it is flipped, so Continue and Skip
 * both leave what the player chose. Not asked when a distribution profile seeds
 * the toggles, because the distributor has already chosen.
 */
export default function ToolsPage() {
  return <FeatureToggles />;
}
