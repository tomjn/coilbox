/**
 * Drives `runDelivery` against the connection this window is on (issue #1279).
 *
 * The whole of the decision-making is in `tweakDelivery.ts` and is tested
 * without any of this. All that lives here is the four things the run cannot
 * work out for itself: how to put a slot on the wire, what the battle currently
 * holds, what the server has said lately, and what time it is.
 *
 * Reads go through refs rather than through the closure, because the run is one
 * long-lived async call and the lobby mirror it is watching is re-rendered
 * underneath it. A closure would be looking at the tags as they were when the
 * user pressed the button, which is exactly the state a confirmation is
 * supposed to move off.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mpSayBattle, mpSetScriptTags } from "../bindings";
import { serverMessagesSince, useMultiplayer } from "../store";
import {
  type DeliveryProgress,
  runDelivery,
  type TweakSlot,
} from "./tweakDelivery";

export interface TweakDelivery {
  progress: DeliveryProgress | null;
  running: boolean;
  /** Send a set. Resolves when the run stops, however it stopped. */
  start: (slots: TweakSlot[]) => Promise<void>;
  /** Ask the run to stop before its next slot. It never abandons one mid-flight,
   *  so what has been sent stays reported honestly. */
  cancel: () => void;
  clear: () => void;
}

export function useTweakDelivery({
  battleId,
  isFounder,
}: {
  battleId: number | null;
  /** The founder writes the script tag itself. Everybody else asks the autohost,
   *  which is what the pacing and the confirmation wait are sized for. */
  isFounder: boolean;
}): TweakDelivery {
  const { mirror, activeKey: serverKey } = useMultiplayer();
  const [progress, setProgress] = useState<DeliveryProgress | null>(null);
  const [running, setRunning] = useState(false);

  const mirrorRef = useRef(mirror);
  mirrorRef.current = mirror;
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Leaving the room stops the run rather than letting it fire commands at
      // a battle nobody is looking at any more.
      cancelRef.current = true;
    };
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const clear = useCallback(() => setProgress(null), []);

  const start = useCallback(
    async (slots: TweakSlot[]) => {
      if (!serverKey || battleId == null || slots.length === 0) return;
      cancelRef.current = false;
      setRunning(true);
      try {
        await runDelivery(
          slots,
          {
            async send(slot) {
              if (isFounder) {
                await mpSetScriptTags({
                  serverKey,
                  tags: { [slot.tagKey]: slot.value },
                });
              } else {
                await mpSayBattle({
                  serverKey,
                  message: `!bSet ${slot.name} ${slot.value}`,
                });
              }
            },
            confirmed(tagKey) {
              const tags =
                mirrorRef.current.state?.battles[String(battleId)]?.scriptTags;
              if (!tags) return undefined;
              // SPADS lowercases a setting name before it sets it, and the
              // engine treats tags case-insensitively, so the key we asked
              // under is not necessarily the key it comes back under.
              const want = tagKey.toLowerCase();
              for (const [key, value] of Object.entries(tags)) {
                if (key.toLowerCase() === want) return value;
              }
              return undefined;
            },
            serverMessageCount: () => mirrorRef.current.serverMessageCount,
            serverMessagesSince: (count) =>
              serverMessagesSince(mirrorRef.current, count),
            sleep: (ms) =>
              new Promise<void>((resolve) => setTimeout(resolve, ms)),
            now: () => Date.now(),
            report: (p) => {
              if (mountedRef.current) setProgress(p);
            },
            cancelled: () => cancelRef.current,
          },
          { viaAutohost: !isFounder },
        );
      } finally {
        if (mountedRef.current) setRunning(false);
      }
    },
    [serverKey, battleId, isFounder],
  );

  return { progress, running, start, cancel, clear };
}
