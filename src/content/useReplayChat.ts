import { useEffect, useState } from "react";
import { type ChatLine, contentDemoChat } from "./bindings";

interface ChatRead {
  messages: ChatLine[];
  incomplete: boolean;
}

/**
 * Reads in flight, so two asks for one replay at the same moment (React's
 * development double effect, or two surfaces) share one walk of the stream. An
 * entry goes once it settles, so a later visit reads again.
 */
const inFlight = new Map<string, Promise<ChatRead>>();

function readChat(replayPath: string): Promise<ChatRead> {
  let held = inFlight.get(replayPath);
  if (!held) {
    held = contentDemoChat({ replayPath });
    inFlight.set(replayPath, held);
    const clear = () => inFlight.delete(replayPath);
    held.then(clear, clear);
  }
  return held;
}

/**
 * A replay's chat and system lines, read once when the replay is shown. The
 * result is keyed on the path it was read for, so another replay shows nothing
 * of it, and an answer that arrives after the path moved on is dropped.
 */
export function useReplayChat(replayPath: string) {
  const [read, setRead] = useState<{
    path: string;
    failed: boolean;
    data: ChatRead | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    readChat(replayPath).then(
      (data) => {
        if (!cancelled) setRead({ path: replayPath, failed: false, data });
      },
      () => {
        if (!cancelled) setRead({ path: replayPath, failed: true, data: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [replayPath]);

  const current = read?.path === replayPath ? read : null;
  return {
    loading: current === null,
    failed: current?.failed ?? false,
    messages: current?.data?.messages ?? null,
    incomplete: current?.data?.incomplete ?? false,
  };
}
