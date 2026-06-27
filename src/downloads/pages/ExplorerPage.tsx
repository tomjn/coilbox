import { useWriteRootPath } from "../config";
import { RapidBrowser } from "./components/RapidBrowser";

/**
 * Browse Rapid: pick a configured rapid master and browse its repositories and
 * versions, downloading a tag through the bundled sidecar into the configured
 * content root. The browsing UI is shared with the Games page via `RapidBrowser`.
 */
export default function ExplorerPage() {
  const writePath = useWriteRootPath();

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-1 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold leading-none">Browse Rapid</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Browse Spring/Recoil rapid content and download a tag through the
          bundled sidecar.
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <RapidBrowser writePath={writePath} />
      </div>
    </div>
  );
}
