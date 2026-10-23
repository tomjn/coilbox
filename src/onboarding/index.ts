import type { FramePlugin } from "@picoframe/plugin-sdk";
import { OnboardingProvider } from "./OnboardingProvider";

/**
 * The first-run setup wizard. Its Provider sits innermost, inside the theme,
 * settings, router, download queue, hub and lobby providers, and draws the
 * wizard as a full window overlay beside the app.
 */
const onboardingPlugin: FramePlugin = {
  id: "onboarding",
  version: "0.0.0",
  routes: [],
  Provider: OnboardingProvider,
};

export default onboardingPlugin;
