import { useEffect, useState } from "react";
import { readTrackHeader, windowLoader } from "./commands";
import { ReplayTrackError } from "./fault";
import { createReplayTrackHandle, type ReplayTrackHandle } from "./handle";

/** What the hook says about a track. */
export type ReplayTrackState =
  | { status: "idle"; handle: null; error: null }
  | { status: "loading"; handle: null; error: null }
  | { status: "ready"; handle: ReplayTrackHandle; error: null }
  | { status: "error"; handle: null; error: ReplayTrackError };

const idle: ReplayTrackState = { status: "idle", handle: null, error: null };
const loading: ReplayTrackState = {
  status: "loading",
  handle: null,
  error: null,
};

/**
 * Opens a replay's recorded track (#3806) and gives back a handle to read it.
 *
 * Opening reads the header and marks the track watched. No window is read until
 * the view calls `handle.follow`. The state changes once when the header
 * arrives and not again: windows loading and dropping do not render anything,
 * and the handle is the same object until the game id changes or the component
 * unmounts, when its windows are dropped. A view that wants to know a window
 * arrived calls `handle.subscribe`.
 *
 * Pass null for a replay with no game id or no current track.
 */
export function useReplayTrack(gameId: string | null): ReplayTrackState {
  const [state, setState] = useState<{
    for: string | null;
    at: ReplayTrackState;
  }>({ for: null, at: idle });

  useEffect(() => {
    if (gameId === null) {
      setState({ for: null, at: idle });
      return;
    }
    let open: { close(): void } | undefined;
    let cancelled = false;
    setState({ for: gameId, at: loading });
    readTrackHeader(gameId).then(
      (header) => {
        if (cancelled) return;
        const owned = createReplayTrackHandle(
          header,
          windowLoader(gameId, header.rotationBits),
        );
        open = owned;
        setState({
          for: gameId,
          at: { status: "ready", handle: owned.handle, error: null },
        });
      },
      (e: unknown) => {
        if (cancelled) return;
        const error =
          e instanceof ReplayTrackError
            ? e
            : new ReplayTrackError({
                kind: "io",
                message: e instanceof Error ? e.message : String(e),
              });
        setState({ for: gameId, at: { status: "error", handle: null, error } });
      },
    );
    return () => {
      cancelled = true;
      open?.close();
    };
  }, [gameId]);

  // The state of an earlier game id is never shown for the current one.
  return state.for === gameId ? state.at : gameId === null ? idle : loading;
}
