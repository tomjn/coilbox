import { Trans } from "@lingui/react/macro";
import { useWriteRootPath } from "../config";
import { RapidBrowser } from "./components/RapidBrowser";

/**
 * Rapid repositories: pick a configured rapid master and browse its repositories
 * and versions, downloading a tag through the bundled sidecar into the configured
 * content root. Advanced mode only (issue #4584), beside Archives in the Library.
 */
export default function ExplorerPage() {
  const writePath = useWriteRootPath("games");

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-1 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold leading-none">
          <Trans>Rapid repositories</Trans>
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          <Trans>
            Browse Spring/Recoil rapid content and download a tag through the
            bundled sidecar.
          </Trans>
        </p>
      </header>
      <div className="min-h-0 flex-1">
        <RapidBrowser writePath={writePath} />
      </div>
    </div>
  );
}
