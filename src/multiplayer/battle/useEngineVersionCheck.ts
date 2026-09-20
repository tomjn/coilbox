import { useEffect, useState } from "react";
import { contentVerifyEngine } from "@/content/bindings";

/**
 * Ask an engine nobody has run for its version, so a battle room can say
 * whether it is the host's.
 *
 * Such an engine only has its folder name, which proves nothing either way. The
 * answer is stored with the engine, so this runs once per engine and not once
 * per battle, and `onVerified` is where the caller reads the engines again.
 *
 * Pass the executable only while the verdict is unverified. Returns true when
 * the engine would not say, which leaves the verdict where it was.
 */
export function useEngineVersionCheck(
  unverifiedExecutable: string | undefined,
  onVerified: () => void,
): boolean {
  const [unreadable, setUnreadable] = useState(false);
  useEffect(() => {
    if (!unverifiedExecutable) return;
    let cancelled = false;
    setUnreadable(false);
    contentVerifyEngine({ path: unverifiedExecutable })
      .then(({ engine }) => {
        if (cancelled) return;
        if (engine.syncVersion) onVerified();
        else setUnreadable(true);
      })
      .catch(() => {
        if (!cancelled) setUnreadable(true);
      });
    return () => {
      cancelled = true;
    };
  }, [unverifiedExecutable, onVerified]);
  return unreadable;
}
