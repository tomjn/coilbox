import { useEffect, useRef, useState } from "react";
import { contentVerifyEngine } from "@/content/bindings";

const NONE: ReadonlySet<string> = new Set();

/**
 * Ask every engine that has not reported its version for it, so multiplayer
 * only ever compares versions an engine gave.
 *
 * A folder name is never a version. The folder can hold any build, a broken
 * one, or another program entirely, and the host's engine refuses a connection
 * on the exact version string. So nothing is matched, shown or advertised until
 * the binary has answered.
 *
 * The answer is stored with the engine, so each is asked once and not once per
 * battle. `onVerified` is where the caller reads the engines again. Returns the
 * executables that would not say, which stay without a version.
 */
export function useEngineVersionCheck(
  unverifiedExecutables: string[],
  onVerified: () => void,
): ReadonlySet<string> {
  const [unreadable, setUnreadable] = useState(NONE);
  // Asked already, whatever the answer, so a re-render or the refresh that
  // follows a success never runs a binary twice.
  const asked = useRef(new Set<string>());
  const key = unverifiedExecutables.join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the list's identity, the array is new every render
  useEffect(() => {
    const todo = unverifiedExecutables.filter((e) => !asked.current.has(e));
    if (todo.length === 0) return;
    for (const e of todo) asked.current.add(e);
    (async () => {
      const failed: string[] = [];
      let verified = false;
      // One at a time: each is a process start, bounded by the backend's
      // timeout, and they write the same store.
      for (const path of todo) {
        try {
          const { engine } = await contentVerifyEngine({ path });
          if (engine.syncVersion) verified = true;
          else failed.push(path);
        } catch {
          failed.push(path);
        }
      }
      if (failed.length > 0) {
        setUnreadable((prev) => new Set([...prev, ...failed]));
      }
      if (verified) onVerified();
      // No cancel on cleanup. These engines are already marked as asked, so an
      // answer dropped here would never be fetched again.
    })();
  }, [key, onVerified]);
  return unreadable;
}
