import type { ReactNode } from "react";
import { useRegisterEngineDirs } from "./config";

/**
 * App-wide provider that keeps the downloads sidecar's engine-dir registry in
 * sync with content state, so pr-downloader resolution can prefer an installed
 * engine's own copy. Renders nothing of its own.
 */
export function EngineDirsProvider({ children }: { children: ReactNode }) {
  useRegisterEngineDirs();
  return <>{children}</>;
}
