import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Flag, Target } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { getCachedScenario, useHasScenarios } from "./scenarios";

/**
 * The Scenarios plugin's frontend half: an advanced-mode **Scenario Builder**
 * for authoring the in-engine content of a mission (spawns, zones, triggers,
 * objectives, dialogue). Documents and dialogue clips are stored by the
 * `tauri-plugin-coilbox-scenario` crate (ACL id `coilbox-scenario`). The schema
 * lives in `model.ts`.
 *
 * The builder gets its own nav group beside Campaign Builder, like the other
 * advanced tools, and its routes are `gateAdvanced`-wrapped so a deep link is
 * not reachable while advanced mode is off.
 *
 * The player-facing half is a Scenarios list that plays a scenario bare. It
 * joins the existing **Play** group (nav groups merge by id) beside Campaigns,
 * because a scenario is something you play rather than something you author,
 * and it is shown only once there is a scenario to play
 * ({@link useHasScenarios}). It is not advanced-gated.
 */
const scenarioPlugin: FramePlugin = {
  id: "scenario",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: "Play",
      order: 5,
      items: [
        {
          id: "scenario.list",
          label: "Scenarios",
          to: "/scenarios",
          // Beside Campaigns (order 1) and before Conquest (order 2), which is
          // where a one-off mission belongs. A fraction keeps it there without
          // renumbering three other plugins' items.
          order: 1.5,
          icon: Target,
          useVisible: useHasScenarios,
        },
      ],
    },
    {
      id: "scenario-builder",
      label: "Scenario Builder",
      order: 36,
      items: [
        {
          id: "scenario.builder",
          label: "Builder",
          to: "/scenario-builder",
          order: 1,
          icon: Flag,
          useVisible: useAdvancedMode,
        },
      ],
    },
  ],
  routes: [
    {
      path: "scenarios",
      lazy: () => import("./pages/ScenariosPage"),
      crumb: "Scenarios",
    },
    {
      path: "scenario-builder",
      lazy: gateAdvanced(() => import("./pages/ScenarioBuilderPage")),
      crumb: "Scenario Builder",
    },
    {
      // The route param is an opaque uuid, so the crumb resolves the scenario's
      // name from the session cache, falling back when the list has not loaded.
      path: "scenario-builder/:id",
      lazy: gateAdvanced(() => import("./pages/ScenarioEditPage")),
      crumb: (c) =>
        (c.params.id && getCachedScenario(c.params.id)?.name) || "Scenario",
    },
  ],
};

export default scenarioPlugin;
