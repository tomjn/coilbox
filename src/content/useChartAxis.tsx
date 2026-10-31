import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useState,
} from "react";
import type { ChartAxis } from "./replayTimeline";

/**
 * The match statistics chart's time axis, handed to the timeline further down
 * the replay page so the two line up (#3856). Two contexts, so the chart that
 * publishes it does not redraw when it changes. With no provider there is no
 * axis to follow.
 */
const AxisContext = createContext<ChartAxis | null>(null);
const SetAxisContext = createContext<
  Dispatch<SetStateAction<ChartAxis | null>>
>(() => {});

export function ChartAxisProvider({ children }: { children: ReactNode }) {
  const [axis, setAxis] = useState<ChartAxis | null>(null);
  return (
    <SetAxisContext.Provider value={setAxis}>
      <AxisContext.Provider value={axis}>{children}</AxisContext.Provider>
    </SetAxisContext.Provider>
  );
}

/** The chart's axis, or null while the page draws no chart. */
export function useChartAxis(): ChartAxis | null {
  return useContext(AxisContext);
}

export function useSetChartAxis() {
  return useContext(SetAxisContext);
}
