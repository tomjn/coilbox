/**
 * Which series a replay page is pointing at, kept once so every surface that
 * draws a player agrees (#1139).
 *
 * A series is named by the engine teams it stands for, not by a chart line id,
 * so the chart in either view, the legend, the roster and the start position
 * map all say the same thing with no translation between them. A player's line
 * is one team and a side's line is all of its members.
 *
 * Three things can point at a series. In order of strength:
 *
 * 1. `hovered`: the pointer or keyboard focus is on it right now. Temporary.
 * 2. `selected`: it was clicked or pressed. It stays until pressed again.
 * 3. `resting`: "Highlight me". What shows when nothing else is pointed at.
 *
 * Emphasis is never a colour change. Surfaces read {@link activeTeams} and add
 * a halo, raise the series, and dim the others, leaving `color` alone.
 */

/** Engine team numbers, sorted ascending. */
export type TeamSet = readonly number[];

export interface EmphasisState {
  hovered: TeamSet | null;
  selected: TeamSet | null;
  resting: TeamSet | null;
  /** Teams that have a line on the chart. A roster seat outside it has nothing to point at. */
  charted: TeamSet;
}

const EMPTY: EmphasisState = {
  hovered: null,
  selected: null,
  resting: null,
  charted: [],
};

export function sameTeams(a: TeamSet | null, b: TeamSet | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

/** The teams to emphasise now, or null when nothing is. */
export function activeTeams(state: EmphasisState): TeamSet | null {
  return state.hovered ?? state.selected ?? state.resting;
}

/** Whether a series (or seat) with these teams is the one being emphasised. */
export function isEmphasised(
  state: EmphasisState,
  teams: TeamSet | null | undefined,
): boolean {
  const active = activeTeams(state);
  return !!active && !!teams && teams.some((t) => active.includes(t));
}

export interface EmphasisStore {
  getState(): EmphasisState;
  subscribe(listener: () => void): () => void;
  /** Point at these teams until `hover(null)`. */
  hover(teams: TeamSet | null): void;
  /** Select these teams, or clear the selection if they already are. */
  toggleSelected(teams: TeamSet): void;
  /** What the chart currently offers: the teams it draws and the resting emphasis. */
  setPlot(plot: { charted: TeamSet; resting: TeamSet | null }): void;
}

export function createEmphasisStore(): EmphasisStore {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  const set = (next: EmphasisState) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hover(teams) {
      if (sameTeams(state.hovered, teams)) return;
      set({ ...state, hovered: teams });
    },
    toggleSelected(teams) {
      set({
        ...state,
        selected: sameTeams(state.selected, teams) ? null : teams,
      });
    },
    setPlot({ charted, resting }) {
      if (
        sameTeams(state.charted, charted) &&
        sameTeams(state.resting, resting)
      )
        return;
      set({ ...state, charted, resting });
    },
  };
}
