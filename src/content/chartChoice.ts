import type { ChartMode, ChartView } from "./matchStats";

/**
 * What the replay page's statistics are asked, held once so every surface that
 * draws them agrees (#5308). The Economy tab's chart and the timeline dock's
 * metric lane read it, and a choice made in either changes both.
 *
 * The metric is a plain key and not a `MetricKey`, because the list a picker
 * offers is not all statistics samples: commands per minute and the living unit
 * value are drawn from other data and carry keys of their own (#5321).
 */
export interface ChartChoice {
  /** The picked metric, or null until the reader picks one, so the opening
   *  metric follows the registry without an effect that would overwrite it. */
  metric: string | null;
  mode: ChartMode;
  /** Null until the reader picks one, so the opening view follows the match's
   *  own size. */
  view: ChartView | null;
}

const OPENING: ChartChoice = {
  metric: null,
  mode: "cumulative",
  view: null,
};

export interface ChartChoiceStore {
  getState(): ChartChoice;
  subscribe(listener: () => void): () => void;
  setMetric(metric: string): void;
  setMode(mode: ChartMode): void;
  setView(view: ChartView): void;
}

export function createChartChoiceStore(): ChartChoiceStore {
  let state = OPENING;
  const listeners = new Set<() => void>();
  const set = (next: ChartChoice) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMetric(metric) {
      if (state.metric !== metric) set({ ...state, metric });
    },
    setMode(mode) {
      if (state.mode !== mode) set({ ...state, mode });
    },
    setView(view) {
      if (state.view !== view) set({ ...state, view });
    },
  };
}
