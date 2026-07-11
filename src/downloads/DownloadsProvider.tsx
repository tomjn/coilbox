import type { ReactNode } from "react";
import { DownloadQueueProvider } from "./DownloadQueueProvider";
import { EngineDirsProvider } from "./EngineDirsProvider";

/**
 * The downloads plugin's app-wide provider: keeps the sidecar engine-dir registry
 * in sync (EngineDirsProvider) and hosts the serial download queue
 * (DownloadQueueProvider), both mounted above the router so an in-flight queue
 * survives navigation.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  return (
    <EngineDirsProvider>
      <DownloadQueueProvider>{children}</DownloadQueueProvider>
    </EngineDirsProvider>
  );
}
