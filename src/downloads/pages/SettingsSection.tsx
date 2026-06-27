import { Button, cn, Input } from "@picoframe/frame";
import {
  AlertCircle,
  Boxes,
  CheckCircle2,
  Download,
  FolderDown,
  Loader2,
  Plus,
  Server,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type ContentRoot,
  contentRescan,
  contentStateLoad,
} from "../../content/bindings";
import {
  dlDownloadEngineRecoil,
  dlDownloadEngineSpring,
  dlRecoilEngines,
  type EngineRelease,
} from "../bindings";
import { useDownloadsConfig } from "../config";
import { Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";
import { errMessage } from "./components/states";

/** Human-readable byte size for engine archives. */
function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1_048_576;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

type EngineSource = "recoil" | "spring";

/**
 * Engines section: download an engine matching this platform into the selected
 * content root's `engine/` dir. Recoil builds come from GitHub releases (7z,
 * extracted client-side); classic Spring engines go through the sidecar's
 * `--download-engine`. A content rescan runs after a successful install so the
 * engine shows up under Content Folders → Engines.
 */
function EnginesSection({ writePath }: { writePath?: string }) {
  const [source, setSource] = useState<EngineSource>("recoil");
  const [releases, setReleases] = useState<EngineRelease[] | null>(null);
  const [platform, setPlatform] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [springVersion, setSpringVersion] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const loadRecoil = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReleases(null);
    try {
      const res = await dlRecoilEngines(undefined);
      setReleases(res.releases);
      setPlatform(res.platform);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (source === "recoil") loadRecoil();
  }, [source, loadRecoil]);

  // Rescan content so a freshly-installed engine appears under Engines.
  async function afterInstall() {
    try {
      await contentRescan(undefined);
    } catch {
      // non-fatal: the engine is installed, the list just won't auto-refresh
    }
  }

  async function downloadRecoil(rel: EngineRelease) {
    if (!writePath) return;
    setDownloading(rel.version);
    setResult(null);
    try {
      const { message } = await dlDownloadEngineRecoil({
        version: rel.version,
        assetUrl: rel.assetUrl,
        writePath,
      });
      setResult({ ok: true, message });
      await afterInstall();
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

  async function downloadSpring() {
    const v = springVersion.trim();
    if (!v) return;
    setDownloading(v);
    setResult(null);
    try {
      const { message } = await dlDownloadEngineSpring({
        version: v,
        writePath,
      });
      setResult({ ok: true, message });
      await afterInstall();
    } catch (e) {
      setResult({ ok: false, message: errMessage(e) });
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <Boxes size={15} /> Engines
      </h2>
      <p className="text-xs text-muted-foreground">
        Download an engine matching this platform into the selected content
        folder's <code>engine/</code> directory.
      </p>
      <OptionSelect
        value={source}
        onValueChange={(v) => setSource(v as EngineSource)}
        className="w-56"
        options={[
          { value: "recoil", label: "Recoil (GitHub releases)" },
          { value: "spring", label: "Spring (pr-downloader)" },
        ]}
      />
      {!writePath && (
        <p className="text-xs text-muted-foreground">
          Pick a download destination above to enable engine downloads.
        </p>
      )}

      {source === "recoil" ? (
        <div className="space-y-2">
          {loading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> loading releases…
            </p>
          )}
          {error && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle size={15} className="mt-px shrink-0" />
              {error}
            </p>
          )}
          {releases && releases.length === 0 && (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              No Recoil builds for this platform ({platform}). On macOS you'll
              need to add an engine manually.
            </p>
          )}
          {releases && releases.length > 0 && (
            <ul className="max-h-80 divide-y divide-border overflow-auto rounded-md border border-border">
              {releases.map((rel) => (
                <li
                  key={rel.version}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {rel.version}
                      {rel.prerelease && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          pre-release
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fmtSize(rel.size)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadRecoil(rel)}
                    disabled={downloading !== null || !writePath}
                    aria-label={`Download engine ${rel.version}`}
                  >
                    {downloading === rel.version ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    {downloading === rel.version ? "Installing…" : "Download"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex items-end gap-2">
          <Field
            label="Engine version"
            hint="exact version string, e.g. 105.1.1-2590-g1234567 bar"
            className="flex-1"
          >
            <Input
              value={springVersion}
              onChange={(e) => setSpringVersion(e.target.value)}
              placeholder="version string"
              className="font-mono text-xs"
            />
          </Field>
          <Button
            variant="outline"
            onClick={downloadSpring}
            disabled={downloading !== null || !springVersion.trim()}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            Download
          </Button>
        </div>
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

/**
 * The downloads plugin's settings section (frame settings page at
 * `/settings/downloads`). Three concerns, all persisted immediately via
 * `useDownloadsConfig` (no Save button) except engine installs:
 *  - the list of rapid masters offered in the Browse Rapid / Games dropdowns
 *  - the content root every download writes into (`--filesystem-writepath`),
 *    chosen from the content plugin's detected roots
 *  - downloading engines matching this platform into that root
 */
export default function DownloadsSettings() {
  const [cfg, setCfg] = useDownloadsConfig();
  const [roots, setRoots] = useState<ContentRoot[]>([]);

  useEffect(() => {
    contentStateLoad(undefined)
      .then(({ state }) => setRoots(state.roots))
      .catch(() => {
        // best-effort: the picker just shows no roots if content state is unavailable
      });
  }, []);

  const addRepo = () =>
    setCfg({
      ...cfg,
      rapidRepos: [
        ...cfg.rapidRepos,
        { id: crypto.randomUUID(), name: "", url: "" },
      ],
    });
  const updateRepo = (id: string, key: "name" | "url", value: string) =>
    setCfg({
      ...cfg,
      rapidRepos: cfg.rapidRepos.map((r) =>
        r.id === id ? { ...r, [key]: value } : r,
      ),
    });
  const removeRepo = (id: string) =>
    setCfg({ ...cfg, rapidRepos: cfg.rapidRepos.filter((r) => r.id !== id) });

  const writePath = roots.find((r) => r.id === cfg.writeRootId)?.path;

  return (
    <div className="space-y-8">
      {/* Rapid masters */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Server size={15} /> Rapid repositories
          </h2>
          <Button variant="outline" size="sm" onClick={addRepo}>
            <Plus /> Add repository
          </Button>
        </div>
        {cfg.rapidRepos.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No rapid repositories. Add one to browse and download games from it.
          </p>
        ) : (
          <ul className="space-y-2">
            {cfg.rapidRepos.map((r) => (
              <li key={r.id} className="flex items-end gap-2">
                <Field label="Name" className="flex-1">
                  <Input
                    value={r.name}
                    onChange={(e) => updateRepo(r.id, "name", e.target.value)}
                    placeholder="Beyond All Reason"
                  />
                </Field>
                <Field label="Master URL" className="flex-[2]">
                  <Input
                    value={r.url}
                    onChange={(e) => updateRepo(r.id, "url", e.target.value)}
                    placeholder="https://repos-cdn.beyondallreason.dev"
                    className="font-mono text-xs"
                  />
                </Field>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeRepo(r.id)}
                  aria-label={`Remove ${r.name || r.url || "repository"}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Download destination */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <FolderDown size={15} /> Download destination
        </h2>
        <p className="text-xs text-muted-foreground">
          The content folder downloads are written into. Detected folders come
          from the Content Folders settings; pick one so games, maps, and
          engines land where the engine can find them.
        </p>
        {roots.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No content folders detected yet. Add or scan one in Content Folders.
          </p>
        ) : (
          <Field label="Write to" className="max-w-md">
            <OptionSelect
              value={cfg.writeRootId ?? ""}
              onValueChange={(v) => setCfg({ ...cfg, writeRootId: v })}
              placeholder="Select a content folder…"
              options={roots.map((root) => ({
                value: root.id,
                label: root.label ? `${root.label} — ${root.path}` : root.path,
              }))}
            />
          </Field>
        )}
      </section>

      <EnginesSection writePath={writePath} />
    </div>
  );
}
