import {
  createContext,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useState,
  useSyncExternalStore,
} from "react";
import {
  activeTeams,
  checkState,
  createEmphasisStore,
  type EmphasisStore,
  isEmphasised,
  isShown,
  type TeamSet,
} from "./seriesEmphasis";

/**
 * The one {@link EmphasisStore} for a replay page. The roster and the match
 * statistics are siblings, so the page owns the store and both read it. Mount
 * it with `key` set to the replay, so one replay's selection can't carry into
 * the next.
 */
const EmphasisContext = createContext<EmphasisStore | null>(null);

export function SeriesEmphasisProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createEmphasisStore);
  return (
    <EmphasisContext.Provider value={store}>
      {children}
    </EmphasisContext.Provider>
  );
}

/**
 * Read and write the emphasised series. A surface asks `isLit(teams)` for each
 * thing it draws, and `dimming` to know whether to fade the ones that are not.
 * The start position map (#1152) needs only these two.
 */
export function useSeriesEmphasis() {
  const store = useContext(EmphasisContext);
  if (!store)
    throw new Error(
      "useSeriesEmphasis needs a SeriesEmphasisProvider above it",
    );
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return {
    store,
    state,
    /** Whether anything is emphasised, so the rest should fade. */
    dimming: activeTeams(state) !== null,
    /** Whether a series or seat with these teams is the emphasised one. */
    isLit: (teams: TeamSet | null | undefined) => isEmphasised(state, teams),
    /** Whether this team has a line on the chart, so can be pointed at. */
    isCharted: (team: number | undefined) =>
      team !== undefined && state.charted.includes(team),
    /** Whether this team's line is drawn: charted, and not unchecked in the roster. */
    isShown: (team: number | undefined) =>
      team !== undefined && isShown(state, team),
    /** How a checkbox for these teams reads, including a side's indeterminate state. */
    checkState: (teams: TeamSet) => checkState(state, teams),
    setShown: store.setShown,
    hover: store.hover,
    toggleSelected: store.toggleSelected,
    /**
     * Pointer handlers for an element that stands for these teams. A touch tap
     * is not a hover: it would stay lit with no way to move off, so touch goes
     * through `toggleSelected` alone.
     */
    pointTo: (teams: TeamSet) => ({
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType !== "touch") store.hover(teams);
      },
      onPointerLeave: () => store.hover(null),
    }),
    /**
     * Focus handlers for a control standing for these teams, so tabbing to it
     * previews it as hovering does. Only keyboard focus counts: a mouse click
     * also focuses, and has already said what it means.
     */
    focusOn: (teams: TeamSet) => ({
      onFocus: (e: FocusEvent<HTMLElement>) => {
        if (e.currentTarget.matches(":focus-visible")) store.hover(teams);
      },
      onBlur: () => store.hover(null),
    }),
  };
}
