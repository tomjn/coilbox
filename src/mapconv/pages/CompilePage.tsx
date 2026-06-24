import { Button, Input } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, FolderOpen, Hammer, Loader2, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { type CompileOpts, type CompressionType, type LogLine, mcCancel, mcCompile, mcOpenPath, mcProbe, mcSuggestSources } from "../bindings";
import { useMapconvConfig } from "../config";
import AdvancedOptions, { type AdvancedCompileOpts, defaultAdvanced } from "./components/AdvancedOptions";
import { Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";
import { PathField } from "./components/PathField";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const TEXTURE_FILTERS = [{ name: "Images", extensions: ["png", "bmp", "tga", "jpg", "jpeg", "tif", "tiff"] }];

const CT_OPTIONS = [
  { value: "1", label: "1 — No compression" },
  { value: "2", label: "2 — Fast (compare last N tiles)" },
  { value: "3", label: "3 — Insane (whole map; very slow)" },
  { value: "4", label: "4 — High quality fast" },
];

/** The parent dir of a native path (handles both / and \ separators). */
function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

/** How many optional flags the user has set, for the drawer button badge. */
function countAdvanced(a: AdvancedCompileOpts): number {
  const strings = [a.heightmap, a.metalmap, a.typemap, a.minimap, a.vegmap, a.features, a.maxh, a.minh, a.th, a.ccount];
  return strings.filter((s) => s.trim() !== "").length + (a.noclamp ? 1 : 0) + (a.smooth ? 1 : 0);
}

/** Build a `.smf`/`.smt` from source images via the `mapcompile` sidecar. */
export default function CompilePage() {
  const [cfg, setCfg] = useMapconvConfig();
  const location = useLocation();

  const [maintexture, setMaintexture] = useState("");
  const [outDir, setOutDir] = useState("");
  const [outSuffix, setOutSuffix] = useState("");
  const [ct, setCt] = useState(() => String(cfg.defaultCompressionType));
  const [advanced, setAdvanced] = useState<AdvancedCompileOpts>(defaultAdvanced);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<{ smfPath: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [probe, setProbe] = useState<{ available: boolean; compile: boolean; decompile: boolean } | null>(null);

  const runIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mcProbe(undefined).then(setProbe).catch(() => {});
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logLines]);

  const canRun = !running && maintexture !== "" && outDir !== "" && outSuffix.trim() !== "";

  function buildOpts(): CompileOpts {
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    const str = (s: string) => (s.trim() === "" ? undefined : s.trim());
    return {
      maintexture,
      outSuffix: outSuffix.trim(),
      compressionType: Number(ct) as CompressionType,
      noclamp: advanced.noclamp,
      smooth: advanced.smooth,
      heightmap: str(advanced.heightmap),
      metalmap: str(advanced.metalmap),
      typemap: str(advanced.typemap),
      minimap: str(advanced.minimap),
      vegmap: str(advanced.vegmap),
      features: str(advanced.features),
      maxh: num(advanced.maxh),
      minh: num(advanced.minh),
      th: num(advanced.th),
      ccount: num(advanced.ccount),
    };
  }

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
      const res = await mcCompile({ opts: buildOpts(), outDir, runId, onLog });
      setResult({ smfPath: res.smfPath });
      if (cfg.rememberDirs) setCfg({ ...cfg, lastTextureDir: dirname(maintexture), lastOutDir: outDir });
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

  // On texture pick, auto-prefill any empty optional fields from conventional
  // siblings in the same folder (heightmap.png, metalmap.png, …). Never
  // overwrites a field the user already set; reveals Advanced if it found any.
  async function pickTexture(path: string) {
    setMaintexture(path);
    if (!path) return;
    try {
      const s = await mcSuggestSources({ texturePath: path });
      let found = false;
      setAdvanced((a) => {
        const merged = { ...a };
        for (const k of ["heightmap", "metalmap", "typemap", "minimap", "vegmap", "features"] as const) {
          if (!merged[k] && s[k]) {
            merged[k] = s[k] as string;
            found = true;
          }
        }
        return merged;
      });
      if (found) setShowAdvanced(true);
    } catch {
      // best-effort; leave fields as-is
    }
  }

  // Arriving from the Decompile page's "Recompile": seed the texture (+ siblings
  // via pickTexture) and output folder from the freshly decompiled directory.
  useEffect(() => {
    const dir = (location.state as { recompileDir?: string } | null)?.recompileDir;
    if (!dir) return;
    const sep = dir.includes("\\") ? "\\" : "/";
    const i = Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\"));
    setOutDir(dir);
    setOutSuffix((i >= 0 ? dir.slice(i + 1) : dir).replace(/-decompiled$/, ""));
    void pickTexture(`${dir}${sep}texture.png`);
    // run once on mount for the incoming navigation state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advancedCount = countAdvanced(advanced);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
          <Hammer size={18} /> Compile map
        </h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Build a Spring <code>.smf</code>/<code>.smt</code> from a main texture and optional source maps.
        </p>
      </header>

      {probe && !probe.compile && (
        <p className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle size={15} className="mt-px shrink-0" />
          The <code>mapcompile</code> sidecar was not found. Bundle SpringMapConvNG or set{" "}
          <code>MAPCONV_MAPCOMPILE_SIDECAR</code>.
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[28rem_1fr]">
        {/* Left: form */}
        <div className="min-h-0 space-y-5 overflow-auto border-r border-border px-6 py-5">
          <PathField
            label="Main texture (-t)"
            hint="required · PNG/TGA/BMP image, dimensions divisible by 1024 · siblings auto-fill below"
            value={maintexture}
            onChange={pickTexture}
            disabled={running}
            filters={TEXTURE_FILTERS}
            defaultPath={cfg.lastTextureDir}
          />
          <PathField
            label="Output folder"
            hint="where the .smf/.smt are written"
            value={outDir}
            onChange={setOutDir}
            disabled={running}
            directory
            defaultPath={cfg.lastOutDir}
          />
          <Field label="Output name (-o)" hint="basename for the .smf/.smt (no extension)">
            <Input value={outSuffix} onChange={(e) => setOutSuffix(e.target.value)} disabled={running} placeholder="mymap" />
          </Field>
          <Field label="Compression type (-ct)">
            <OptionSelect value={ct} onValueChange={setCt} disabled={running} options={CT_OPTIONS} />
          </Field>

          {/* Advanced options: optional maps, height range, compression tuning. */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Advanced options
              {advancedCount > 0 ? ` (${advancedCount})` : ""}
            </button>
            {showAdvanced && (
              <div className="mt-4">
                <AdvancedOptions value={advanced} onChange={setAdvanced} defaultPath={cfg.lastTextureDir} disabled={running} />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            {running ? (
              <Button variant="outline" onClick={cancel}>
                <Square /> Cancel
              </Button>
            ) : (
              <Button onClick={run} disabled={!canRun}>
                <Play /> Compile
              </Button>
            )}
            {running && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> compiling…
              </span>
            )}
          </div>
        </div>

        {/* Right: live log + result */}
        <div className="flex min-h-0 flex-col">
          {result && (
            <div className="border-b border-border bg-card/50 px-4 py-3">
              <div className="flex items-start gap-2 text-sm">
                <CheckCircle2 size={15} className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Compiled <span className="font-mono text-xs">{result.smfPath}</span>
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => mcOpenPath({ path: outDir }).catch(() => {})}
              >
                <FolderOpen /> Show in folder
              </Button>
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
                <Hammer size={26} className="opacity-30" />
                <p>Compile output streams here.</p>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                {logLines.map((l, i) => (
                  <div
                    // log lines are append-only; index is a stable key here
                    key={i}
                    className={l.stream === "err" ? "text-amber-600 dark:text-amber-400" : "text-foreground/90"}
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
