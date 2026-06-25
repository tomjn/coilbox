import { Button, cn } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Hammer,
  Loader2,
  PackageOpen,
  Play,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  type LogLine,
  type MapAppearance,
  type MapInfo,
  mcCancel,
  mcDecompile,
  mcOpenPath,
  mcProbe,
  mcReadMapinfo,
} from "../bindings";
import { useMapconvConfig } from "../config";
import { MapPreview3D } from "./components/MapPreview3D";
import { PathField } from "./components/PathField";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const INPUT_FILTERS = [
  { name: "Spring map or archive", extensions: ["smf", "sdz", "sd7"] },
];
const ACCEPTS = /\.(smf|sdz|sd7)$/i;

/** The parent dir of a native path (handles both / and \ separators). */
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

/** Join a directory and filename using the directory's native separator. */
function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${name}`;
}

type Result = {
  directory: string;
  mapInfo?: MapInfo | null;
  minimap?: string | null;
  appearance?: MapAppearance | null;
};

/** Extract source images from a `.smf`, or a `.sdz`/`.sd7` archive. */
export default function DecompilePage() {
  const [cfg, setCfg] = useMapconvConfig();
  const navigate = useNavigate();

  const [inputPath, setInputPath] = useState("");
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{
    available: boolean;
    compile: boolean;
    decompile: boolean;
  } | null>(null);

  const [dragging, setDragging] = useState(false);

  const runIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  // Mirror `running` into a ref so the (mount-once) drop listener sees the
  // current value without re-subscribing.
  const runningRef = useRef(running);
  runningRef.current = running;

  useEffect(() => {
    mcProbe(undefined)
      .then(setProbe)
      .catch(() => {});
  }, []);

  // Native file drop (Tauri exposes real paths; HTML5 drag-drop can't in a webview).
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragging(true);
        } else if (p.type === "leave") {
          setDragging(false);
        } else if (p.type === "drop") {
          setDragging(false);
          if (runningRef.current) return;
          const file = p.paths.find((f) => ACCEPTS.test(f));
          if (file) {
            setInputPath(file);
            setRunError(null);
          } else if (p.paths.length) {
            setRunError("Drop a .smf, .sdz, or .sd7 file.");
          }
        }
      })
      .then((fn) => {
        if (active) unlisten = fn;
        else fn();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: logLines is the trigger that should re-run the scroll, not read in the body
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logLines]);

  const canRun = !running && inputPath !== "";

  async function run() {
    setRunning(true);
    setResult(null);
    setRunError(null);
    setLogLines([]);
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const onLog = new Channel<LogLine>();
    onLog.onmessage = (line) => setLogLines((prev) => [...prev, line]);
    try {
      const res = await mcDecompile({ inputPath, runId, onLog });
      // Best-effort mapinfo.lua read for metadata + preview appearance hints.
      const appearance = await mcReadMapinfo({ path: res.directory }).catch(
        () => null,
      );
      setResult({
        directory: res.directory,
        mapInfo: res.mapInfo,
        minimap: res.minimap,
        appearance,
      });
      if (cfg.rememberDirs) setCfg({ ...cfg, lastSmfDir: dirname(inputPath) });
    } catch (e) {
      setRunError(errMessage(e));
    } finally {
      setRunning(false);
      runIdRef.current = null;
    }
  }

  async function cancel() {
    if (runIdRef.current) {
      try {
        await mcCancel({ runId: runIdRef.current });
      } catch {
        // the run promise settles with its own error
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
          <PackageOpen size={18} /> Decompile map
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Extract the source images (texture, heightmap, metal/type maps,
          features) from a Spring <code>.smf</code>, or from a packaged{" "}
          <code>.sdz</code>/<code>.sd7</code> archive (extracted automatically).
        </p>
      </header>

      {probe && !probe.decompile && (
        <p className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle size={15} className="mt-px shrink-0" />
          The <code>mapdecompile</code> sidecar was not found. Bundle
          SpringMapConvNG or set <code>MAPCONV_MAPDECOMPILE_SIDECAR</code>.
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[28rem_minmax(0,1fr)]">
        {/* Left: form. The whole column is a drop target while dragging. */}
        <div
          className={cn(
            "min-h-0 space-y-5 overflow-auto border-r border-border px-6 py-5 transition-colors",
            dragging && "bg-primary/5 ring-2 ring-inset ring-primary/60",
          )}
        >
          <PathField
            label="Map (.smf / .sdz / .sd7)"
            hint="browse, or drag a .smf/.sdz/.sd7 onto the window · archives are extracted then decompiled"
            value={inputPath}
            onChange={setInputPath}
            disabled={running}
            filters={INPUT_FILTERS}
            defaultPath={cfg.lastSmfDir}
          />

          <div className="flex items-center gap-2 pt-1">
            {running ? (
              <Button variant="outline" onClick={cancel}>
                <Square /> Cancel
              </Button>
            ) : (
              <Button onClick={run} disabled={!canRun}>
                <Play /> Decompile
              </Button>
            )}
            {running && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> decompiling…
              </span>
            )}
          </div>
        </div>

        {/* Right: live log + result */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {result && (
            <div className="border-b border-border bg-card/50 p-4">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2
                  size={15}
                  className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400"
                />
                <span className="min-w-0 break-all">
                  Extracted into{" "}
                  <span className="font-mono text-xs">{result.directory}</span>
                </span>
              </div>
              {result.appearance?.name && (
                <div className="mt-3">
                  <h2 className="text-sm font-semibold leading-tight">
                    {result.appearance.name}
                    {result.appearance.version && (
                      <span className="ml-1.5 font-normal text-muted-foreground">
                        v{result.appearance.version}
                      </span>
                    )}
                  </h2>
                  {result.appearance.description && (
                    <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
                      {result.appearance.description}
                    </p>
                  )}
                  {result.appearance.author && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      by {result.appearance.author}
                    </p>
                  )}
                </div>
              )}
              {(result.minimap || result.mapInfo) && (
                <div className="mt-3 flex flex-wrap items-start gap-4">
                  {result.minimap && (
                    <img
                      src={result.minimap}
                      alt="Map minimap"
                      className="h-32 w-32 rounded-md border border-border object-cover"
                    />
                  )}
                  {result.mapInfo && <MapFacts info={result.mapInfo} />}
                </div>
              )}
              {result.mapInfo && (
                <MapPreview3D
                  className="mt-3"
                  heightmapPath={joinPath(result.directory, "heightmap.png")}
                  texturePath={joinPath(result.directory, "texture.png")}
                  // Prefer the mapinfo.lua range (what the engine uses) over the
                  // baked-in SMF header, falling back when there's no mapinfo.lua.
                  minHeight={
                    result.appearance?.minHeight ?? result.mapInfo.minHeight
                  }
                  maxHeight={
                    result.appearance?.maxHeight ?? result.mapInfo.maxHeight
                  }
                  worldWidth={result.mapInfo.worldWidth}
                  worldHeight={result.mapInfo.worldHeight}
                  appearance={result.appearance}
                />
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    mcOpenPath({ path: result.directory }).catch(() => {})
                  }
                >
                  <FolderOpen /> Show in folder
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    navigate("/mapconv", {
                      state: { recompileDir: result.directory },
                    })
                  }
                >
                  <Hammer /> Recompile
                </Button>
              </div>
            </div>
          )}
          {runError && (
            <p className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={15} className="mt-px shrink-0" />
              {runError}
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-auto bg-card/20 p-4">
            {logLines.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
                <PackageOpen size={26} className="opacity-30" />
                <p>Decompile output streams here.</p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {logLines.map((l, i) => (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only; index is a stable key
                    key={i}
                    className={
                      l.stream === "err"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-foreground/90"
                    }
                  >
                    {l.line}
                  </div>
                ))}
                <div ref={logEndRef} />
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact facts read from the SMF header. */
function MapFacts({ info }: { info: MapInfo }) {
  const rows: [string, string][] = [
    ["Size", `${info.mapx} × ${info.mapy} squares`],
    ["World", `${info.worldWidth} × ${info.worldHeight} elmos`],
    ["Height", `${info.minHeight} → ${info.maxHeight}`],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono text-xs">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
