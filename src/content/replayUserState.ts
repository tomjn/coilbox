import { useSetting } from "@picoframe/frame";

/**
 * Per-replay user state — a watched flag and free-form tags — persisted through the
 * frame settings store (like the skirmish presets), keyed by the replay's filename
 * (stable within a content root, and available in the cheap list summary where the
 * demo's game-id isn't). Kept out of the Rust store so it needs no new commands.
 */
export interface ReplayUserState {
  watched?: boolean;
  tags?: string[];
}

export function useReplayUserState() {
  const [state, setState] = useSetting<Record<string, ReplayUserState>>(
    "content.replayState",
    {},
  );

  const get = (key: string): ReplayUserState => state[key] ?? {};

  const setWatched = (key: string, watched: boolean) => {
    setState({ ...state, [key]: { ...state[key], watched } });
  };

  const setTags = (key: string, tags: string[]) => {
    setState({ ...state, [key]: { ...state[key], tags } });
  };

  /** Every tag in use, sorted, for the filter dropdown. */
  const allTags = (): string[] => {
    const set = new Set<string>();
    for (const s of Object.values(state)) {
      for (const t of s.tags ?? []) set.add(t);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  };

  return { state, get, setWatched, setTags, allTags };
}
