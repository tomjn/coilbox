import { Button, cn } from "@picoframe/frame";
import { AlertCircle, CheckCircle2, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { contentRescan } from "../../../content/bindings";
import {
  dlDownloadEngineRecoil,
  dlDownloadEngineSpring,
  dlRecoilEngines,
  dlSpringfilesEngines,
} from "../../bindings";
import { useWriteRootPath } from "../../config";
import { OptionSelect } from "./OptionSelect";
import { errMessage } from "./states";

/** Human-readable byte size for engine archives. */
function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

type Source = "recoil" | "springfiles";

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
  const writePath = useWriteRootPath();
  const [source, setSource] = useState<Source>("recoil");
  const [items, setItems] = useState<EngineItem[] | null>(null);
  const [platform, setPlatform] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const load = useCallback(async (src: Source) => {
    setLoading(true);
    setError(null);
    setItems(null);
    setResult(null);
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
        const { engines } = await dlSpringfilesEngines(undefined);
        setItems(
          engines.map((e) => ({
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

  async function download(item: EngineItem) {
    if (!writePath) return;
    setDownloading(item.key);
    setResult(null);
    try {
      const { message } =
        source === "recoil"
          ? await dlDownloadEngineRecoil({
              version: item.key,
              assetUrl: item.assetUrl ?? "",
              writePath,
            })
          : await dlDownloadEngineSpring({ version: item.key, writePath });
      setResult({ ok: true, message });
      // Rescan content so the freshly-installed engine appears in the list above.
      try {
        await contentRescan(undefined);
      } catch {
        // non-fatal: the engine is installed, the list just won't auto-refresh
      }
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <h2 className="text-sm font-semibold">Download an engine</h2>
      <p className="text-xs text-muted-foreground">
        Installs an engine matching this platform into the configured content
        folder's <code>engine/</code> directory (set the destination in
        Downloads settings).
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
      {!writePath && (
        <p className="text-xs text-muted-foreground">
          No download destination set — choose a content folder in Downloads
          settings to enable engine downloads.
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={15} className="animate-spin" /> loading engines…
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle size={15} className="mt-px shrink-0" />
          {error}
        </p>
      )}
      {items && items.length === 0 && (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {source === "recoil"
            ? `No Recoil builds for this platform (${platform}). On macOS, add an engine manually.`
            : "No engines found on springfiles."}
        </p>
      )}
      {items && items.length > 0 && (
        <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border">
          {items.map((item) => (
            <li
              key={item.key}
              className="flex items-center justify-between gap-3 px-4 py-2"
            >
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
                onClick={() => download(item)}
                disabled={downloading !== null || !writePath}
                aria-label={`Download engine ${item.title}`}
              >
                {downloading === item.key ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {downloading === item.key ? "Installing…" : "Download"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {result && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            result.ok
              ? "border-border bg-card text-card-foreground"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {result.ok ? (
            <CheckCircle2
              size={16}
              className="mt-px shrink-0 text-emerald-500"
            />
          ) : (
            <AlertCircle size={16} className="mt-px shrink-0" />
          )}
          <span className="min-w-0 break-words">{result.message}</span>
        </div>
      )}
    </section>
  );
}
