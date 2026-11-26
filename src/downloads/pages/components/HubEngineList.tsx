import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { formatBytes } from "@/lib/format";
import { errorText } from "@/lib/helpers";
import { useInstalledEngines } from "../../../content/replayAnalysisOffer";
import { useHubAccount } from "../../../hub/account";
import { canUploadEngines } from "../../../hub/archiveUploads";
import { useHubUrl, useTrustedHubUrl } from "../../../hub/config";
import { dlHubEnginePlatform } from "../../bindings";
import { useWriteRoot } from "../../config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadQueue,
} from "../../DownloadQueueProvider";
import { loadOfficialBuilds } from "../../engineLists";
import {
  fetchHubEngines,
  HUB_ENGINE_WARNING,
  type HubEngine,
  isEngineInstalled,
  offeredHubEngines,
} from "../../hubEngines";
import { EngineUpload } from "./EngineUpload";
import { QueueProgress } from "./ProgressBar";

/**
 * The engine builds the hub offers for this computer, below the Recoil and
 * springfiles installer. A build an official release already covers is
 * hidden. Hidden altogether when the distribution turned the hub off or no
 * engine is built for this computer's platform.
 */
export function HubEngineList() {
  const { t, i18n } = useLingui();
  const hubUrl = useHubUrl();
  const hubOn = useTrustedHubUrl() !== null;
  const account = useHubAccount(hubUrl);
  const { path: writePath } = useWriteRoot();
  const { enqueue, itemFor, active } = useDownloadQueue();
  const installed = useInstalledEngines();
  const [platform, setPlatform] = useState<string | null>(null);
  const [engines, setEngines] = useState<HubEngine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [canUpload, setCanUpload] = useState(false);

  const load = useCallback(async () => {
    if (!hubOn) return;
    setLoading(true);
    setError(null);
    try {
      const { platform } = await dlHubEnginePlatform(undefined);
      setPlatform(platform);
      if (!platform) {
        setEngines([]);
        return;
      }
      // GitHub limiting requests leaves the official builds unknown. The list
      // still shows then, since hiding is only there to avoid offering a hub
      // build beside an official one of the same version.
      const [listed, official] = await Promise.all([
        fetchHubEngines(hubUrl, platform),
        loadOfficialBuilds()
          .then((r) => r.builds)
          .catch(() => []),
      ]);
      setEngines(offeredHubEngines(listed, official, platform));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [hubUrl, hubOn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Asked again when the sign in changes, so signing in shows the button.
  useEffect(() => {
    if (!hubOn || !account.signedIn) {
      setCanUpload(false);
      return;
    }
    let live = true;
    canUploadEngines(hubUrl)
      .then((allowed) => live && setCanUpload(allowed))
      .catch(() => live && setCanUpload(false));
    return () => {
      live = false;
    };
  }, [hubUrl, hubOn, account.signedIn]);

  if (!hubOn) return null;
  // Nothing is built for this computer, and there is nothing to upload from it
  // that the hub could not take from anywhere else.
  if (platform === null && engines !== null && !canUpload) return null;

  const engineInput = (engine: HubEngine): EnqueueInput | null => {
    if (!writePath) return null;
    const version = engine.version;
    return {
      kind: "engineHub",
      label: t`Engine ${version} (hub test build)`,
      sizeBytes: engine.size,
      args: {
        version: engine.version,
        sources: engine.sources,
        sha256: engine.sha256,
        writePath,
      },
    };
  };

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">
        <Trans>Hub test builds</Trans>
      </h2>
      <Alert>
        <AlertTriangle size={15} />
        <AlertDescription>{HUB_ENGINE_WARNING}</AlertDescription>
      </Alert>
      {canUpload && <EngineUpload hubUrl={hubUrl} onListed={load} />}

      {loading && engines === null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" />{" "}
          <Trans>loading test builds…</Trans>
        </p>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle size={15} />
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}
      {engines && engines.length === 0 && platform && (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          <Trans>The hub has no test builds for this computer.</Trans>
        </p>
      )}
      {engines && engines.length > 0 && (
        <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border">
          {engines.map((engine) => {
            const input = engineInput(engine);
            const queueItem = input ? itemFor(identityOf(input)) : null;
            const version = engine.version;
            // An engine already on disk shows as installed, however it got there.
            const status =
              queueItem?.status ??
              (isEngineInstalled(installed, version) ? "done" : null);
            const listed = engine.listedAt
              ? i18n.date(new Date(engine.listedAt), { dateStyle: "medium" })
              : "";
            return (
              <li key={engine.sha256} className="flex flex-col gap-2 px-4 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">{version}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(engine.size)}
                      {listed && ` · ${listed}`}
                    </p>
                    {engine.note && (
                      <p className="whitespace-pre-line text-xs">
                        {engine.note}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {engine.pageUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openUrl(engine.pageUrl).catch(() => {})}
                        aria-label={t`Open the hub page for ${version}`}
                      >
                        <ExternalLink />
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => input && enqueue(input)}
                      disabled={
                        !input ||
                        status === "queued" ||
                        status === "active" ||
                        status === "done"
                      }
                      aria-label={t`Download engine ${version}`}
                    >
                      {status === "active" ? (
                        <Loader2 className="animate-spin" />
                      ) : status === "done" ? (
                        <CheckCircle2 className="text-emerald-500" />
                      ) : (
                        <Download />
                      )}
                      {status === "active"
                        ? t`Installing…`
                        : status === "queued"
                          ? t`Queued`
                          : status === "done"
                            ? t`Installed`
                            : active
                              ? t`Add to queue`
                              : t`Install`}
                    </Button>
                  </div>
                </div>
                <QueueProgress item={queueItem} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
