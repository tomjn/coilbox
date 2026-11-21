import { fireEvent, screen } from "@testing-library/react";
import type { DemoInfo } from "./bindings";
import {
  HeatWindowLabel,
  HeatWindowPlot,
  useHeatWindowLane,
} from "./pages/components/ReplayHeatWindow";

/**
 * For the tests of the map's layers, which read the time window the timeline
 * dock's Heat window lane sets (#5309). Render it beside the map, inside a
 * `SeriesEmphasisProvider`, and the window can be set as a reader sets it.
 * Mock `useMatchStats` first, as the lane reads it for its shading.
 */
export function WindowLane({ info }: { info: DemoInfo }) {
  const lane = useHeatWindowLane(info, null, info.durationSec);
  return lane ? (
    <>
      <HeatWindowLabel lane={lane} id="heat-label" />
      <HeatWindowPlot lane={lane} labelId="heat-label" />
    </>
  ) : null;
}

/** Opens the lane's label and presses one of its presets, such as "Whole match". */
export function pressWindowPreset(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Heat window" }));
  fireEvent.click(screen.getByRole("button", { name }));
}
