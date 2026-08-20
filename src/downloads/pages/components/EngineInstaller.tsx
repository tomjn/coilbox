import { Button } from "@picoframe/frame";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { dlRecoilEngines, dlSpringfilesEngines } from "../../bindings";
import { useWriteRoot } from "../../config";
import {
  type EnqueueInput,
  identityOf,
  useDownloadQueue,
} from "../../DownloadQueueProvider";
import {
  type EngineSource,
  emptyEngineListMessage,
} from "../../emptyEngineList";
import { OptionSelect } from "./OptionSelect";
import { QueueProgress } from "./ProgressBar";
import { errMessage } from "./states";

/** Human-readable byte size for engine archives. */
function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

type Source = EngineSource;

/** A normalised engine row, regardless of source. */
interface EngineItem {
  /** version (recoil) or springname (springfiles) — the download identifier. */
  key: string;
  title: string;
  subtitle?: string;
  /** secondary line, e.g. the springfiles filename. */
  detail?: string;
  prerelease?: boolean;
  /** recoil only: the 7z asset to download. */
  assetUrl?: string;
}

/**
 * Engine installer: download an engine matching this platform into the
 * configured content root's `engine/` dir. Recoil builds come from GitHub
 * releases (7z, extracted client-side); springfiles engines go through the
 * sidecar's `--download-engine`. A content rescan runs after a successful
 * install so the engine appears in the list above. Embedded in the content
 * plugin's Engines settings page.
 */
export function EngineInstaller() {
  const { path: writePath, loading: writeRootLoading } = useWriteRoot();
  // Only once the read has landed and said there is none. Before that `writePath`
  // is undefined whatever the user has configured (issue #1104).
  const noWriteRoot = !writeRootLoading && !writePath;
  const { enqueue, itemFor, active } = useDownloadQueue();
  const [source, setSource] = useState<Source>("recoil");
  const [items, setItems] = useState<EngineItem[] | null>(null);
  const [platform, setPlatform] = useState("");
  // Whether springfiles publishes engines for this machine at all. Assumed true
  // until a springfiles load says otherwise, so an empty list never claims a
  // permanent gap it has not been told about.
  const [listsThisPlatform, setListsThisPlatform] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      if (src === "recoil") {
        const res = await dlRecoilEngines(undefined);
        setPlatform(res.platform);
        setItems(
          res.releases.map((r) => ({
            key: r.version,
            title: r.version,
            subtitle: fmtSize(r.size),
            prerelease: r.prerelease,
            assetUrl: r.assetUrl,
          })),
        );
      } else {
        const res = await dlSpringfilesEngines(undefined);
        setPlatform(res.platform);
        setListsThisPlatform(res.listsThisPlatform);
        setItems(
          res.engines.map((e) => ({
            key: e.version,
            title: `${e.name} ${e.version}`.trim(),
            subtitle: fmtSize(e.size),
            detail: e.filename,
          })),
        );
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(source);
  }, [source, load]);

  // The queue request for an engine. Recoil builds carry a 7z asset URL; both
  // land in `<root>/engine/` and trigger a content rescan on completion (run by
  // the queue runner). Returns null when no destination is configured.
  const engineInput = useCallback(
    (item: EngineItem): EnqueueInput | null => {
      if (!writePath) return null;
      if (source === "recoil") {
        return {
          kind: "engineRecoil",
          label: `Engine ${item.title}`,
          args: {
            version: item.key,
            assetUrl: item.assetUrl ?? "",
            writePath,
          },
        };
      }
      return {
        kind: "engineSpring",
        label: `Engine ${item.title}`,
        args: { version: item.key, writePath },
      };
    },
    [writePath, source],
  );

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Download an engine</h2>
      <p className="text-xs text-muted-foreground">
        Installs an engine matching this platform into the configured content
        folder's <code>engine/</code> directory (set the destination in{" "}
        <Link className="underline underline-offset-4" to="/settings/downloads">
          Downloads settings
        </Link>
        ).
      </p>
      <OptionSelect
        value={source}
        onValueChange={(v) => setSource(v as Source)}
        className="w-56"
        options={[
          { value: "recoil", label: "Recoil (GitHub releases)" },
          { value: "springfiles", label: "springfiles" },
        ]}
      />
      {noWriteRoot && (
        <p className="text-xs text-muted-foreground">
          No download destination set — choose a content folder in{" "}
          <Link
            className="underline underline-offset-4"
            to="/settings/downloads"
          >
            Downloads settings
          </Link>{" "}
          to enable engine downloads.
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" /> loading engines…
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
      {items && items.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyEngineListMessage({ source, platform, listsThisPlatform })}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border">
          {items.map((item) => {
            const input = engineInput(item);
            const queueItem = input ? itemFor(identityOf(input)) : null;
            const status = queueItem?.status ?? null;
            return (
              <li key={item.key} className="flex flex-col gap-2 px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.title}
                      {item.prerelease && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          pre-release
                        </span>
                      )}
                    </p>
                    {item.detail && (
                      <p
                        className="truncate font-mono text-xs text-muted-foreground"
                        title={item.detail}
                      >
                        {item.detail}
                      </p>
                    )}
                    {item.subtitle && (
                      <p className="text-xs text-muted-foreground">
                        {item.subtitle}
                      </p>
                    )}
                  </div>
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
                    aria-label={`Download engine ${item.title}`}
                  >
                    {status === "active" ? (
                      <Loader2 className="animate-spin" />
                    ) : status === "done" ? (
                      <CheckCircle2 className="text-emerald-500" />
                    ) : (
                      <Download />
                    )}
                    {status === "active"
                      ? "Installing…"
                      : status === "queued"
                        ? "Queued"
                        : status === "done"
                          ? "Done"
                          : active
                            ? "Add to queue"
                            : "Install"}
                  </Button>
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
