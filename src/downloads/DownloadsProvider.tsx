import { type ReactNode, useEffect } from "react";
import { useTrustedHubUrl } from "../hub/config";
import { DownloadQueueProvider } from "./DownloadQueueProvider";
import { EngineDirsProvider } from "./EngineDirsProvider";
import { setHubMapBase } from "./hubMapBase";

/**
 * The downloads plugin's app-wide provider: keeps the sidecar engine-dir registry
 * in sync (EngineDirsProvider) and hosts the serial download queue
 * (DownloadQueueProvider), both mounted above the router so an in-flight queue
 * survives navigation. It also tells the map downloader which hub to ask for a
 * map's sources.
 */
export function DownloadsProvider({ children }: { children: ReactNode }) {
  const hubUrl = useTrustedHubUrl();
  useEffect(() => {
    setHubMapBase(hubUrl);
  }, [hubUrl]);
  return (
    <EngineDirsProvider>
      <DownloadQueueProvider>{children}</DownloadQueueProvider>
    </EngineDirsProvider>
  );
}
