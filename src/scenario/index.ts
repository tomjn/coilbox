import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Flag } from "lucide-react";
import { gateAdvanced, useAdvancedMode } from "../general/advanced";
import { getCachedScenario } from "./scenarios";

/**
 * The Scenarios plugin's frontend half: an advanced-mode **Scenario Builder**
 * for authoring the in-engine content of a mission (spawns, zones, triggers,
 * objectives, dialogue). Documents and dialogue clips are stored by the
 * `tauri-plugin-coilbox-scenario` crate (ACL id `coilbox-scenario`). The schema
 * lives in `model.ts`.
 *
 * The builder gets its own nav group beside Campaign Builder, like the other
 * advanced tools, and its routes are `gateAdvanced`-wrapped so a deep link is
 * not reachable while advanced mode is off. The player-facing half, a Scenarios
 * list that plays a scenario bare, is issue #767.
 */
const scenarioPlugin: FramePlugin = {
  id: "scenario",
  version: "0.0.0",
  nav: [
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
