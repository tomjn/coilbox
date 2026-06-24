import { Button, Input, useDrawer } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle2, Hammer, Loader2, Play, Settings2, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type CompileOpts, type CompressionType, type LogLine, mcCancel, mcCompile, mcProbe } from "../bindings";
import { useMapconvConfig } from "../config";
import CompileOptionsForm, { type AdvancedCompileOpts, defaultAdvanced } from "./components/CompileOptionsForm";
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
  const drawer = useDrawer();

  const [maintexture, setMaintexture] = useState("");
  const [outDir, setOutDir] = useState("");
  const [outSuffix, setOutSuffix] = useState("");
  const [ct, setCt] = useState(() => String(cfg.defaultCompressionType));
  const [advanced, setAdvanced] = useState<AdvancedCompileOpts>(defaultAdvanced);

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

  function openOptions() {
    drawer.open({
      title: "Compile options",
      description: "Optional source maps, height range, and compression tuning.",
      width: "40rem",
      content: (
        <CompileOptionsForm
          initial={advanced}
          defaultPath={cfg.lastTextureDir}
          onApply={(a) => {
            setAdvanced(a);
            drawer.close();
          }}
        />
      ),
    });
  }

  const advancedCount = countAdvanced(advanced);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <Hammer size={18} /> Compile map
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Build a Spring <code>.smf</code>/<code>.smt</code> from a main texture and optional source maps.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={openOptions} disabled={running}>
          <Settings2 /> Compile options{advancedCount > 0 ? ` (${advancedCount})` : ""}
        </Button>
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
            hint="required; dimensions divisible by 1024"
            value={maintexture}
            onChange={setMaintexture}
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
            <div className="flex items-start gap-2 border-b border-border bg-card/50 px-4 py-3 text-sm">
              <CheckCircle2 size={15} className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Compiled <span className="font-mono text-xs">{result.smfPath}</span>
              </span>
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
