import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import {
  contentStatsQuery,
  STATS_UPDATED_EVENT,
  type StatRecord,
} from "@/content/bindings";
import {
  refightFilenames,
  scriptedModeFilenames,
  useReplayUserState,
} from "@/content/replayUserState";
import {
  type BonusSuggestions,
  bonusSuggestionsFor,
} from "./aiBonusSuggestion";
import type { Participant } from "./participants";

const NONE: BonusSuggestions = { rows: {}, all: null };

/**
 * The stored replay records, read once per session. This is a read of the stats
 * store, not an ingest: it decodes no replay and walks no folder. A replay that
 * nothing has ingested yet (the Stats page and the live watcher do that) is not
 * in it. A failed read is not kept, so the next mount tries again.
 */
let loaded: Promise<StatRecord[]> | null = null;

function loadRecords(): Promise<StatRecord[]> {
  if (!loaded) {
    const attempt: Promise<StatRecord[]> = contentStatsQuery(undefined).then(
      (q) => q.records,
      (e) => {
        if (loaded === attempt) loaded = null;
        throw e;
      },
    );
    loaded = attempt;
  }
  return loaded;
}

/**
 * Suggested AI bonuses for the setup, from your recent results. The suggestion
 * is optional, so it loads in the background: nothing while it loads, and
 * nothing if it fails.
 */
export function useAiBonusSuggestions(
  participants: Participant[],
  gameName: string,
): BonusSuggestions {
  const [records, setRecords] = useState<StatRecord[] | null>(null);
  const { state } = useReplayUserState();

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      loadRecords().then(
        (r) => {
          if (!cancelled) setRecords(r);
        },
        () => {},
      );
    };
    read();

    // The watcher has stored a new replay: read the store again.
    let unlisten: (() => void) | undefined;
    try {
      listen(STATS_UPDATED_EVENT, () => {
        loaded = null;
        read();
      })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    } catch {
      // No event bridge: the suggestion still works from the first read.
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const refights = useMemo(() => refightFilenames(state), [state]);
  const scripted = useMemo(() => scriptedModeFilenames(state), [state]);

  return useMemo(
    () =>
      records
        ? bonusSuggestionsFor({
            participants,
            gameName,
            records,
            refights,
            scripted,
          })
        : NONE,
    [records, participants, gameName, refights, scripted],
  );
}
