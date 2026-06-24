import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { AlertCircle, CheckCircle2, Loader2, PackageOpen, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type DecompileOpts, type LogLine, mcCancel, mcDecompile, mcProbe } from "../bindings";
import { useMapconvConfig } from "../config";
import { Field } from "./components/Field";
import { PathField } from "./components/PathField";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const SMF_FILTERS = [{ name: "Spring map", extensions: ["smf"] }];

/** Split a native path into [parent dir, basename] (handles / and \). */
function splitPath(p: string): [string, string] {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? [p.slice(0, i), p.slice(i + 1)] : ["", p];
}

/** Extract source images from a `.smf` via the `mapdecompile` sidecar. */
export default function DecompilePage() {
  const [cfg, setCfg] = useMapconvConfig();

  const [smfPath, setSmfPath] = useState("");
  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<{ directory: string } | null>(null);
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

  const [directory, mapfile] = splitPath(smfPath);
  const canRun = !running && smfPath !== "" && directory !== "";

  async function run() {
    setRunning(true);
    setResult(null);
    setRunError(null);
    setLogLines([]);
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const onLog = new Channel<LogLine>();
    onLog.onmessage = (line) => setLogLines((prev) => [...prev, line]);
    const opts: DecompileOpts = { directory, mapfile };
    try {
      const res = await mcDecompile({ opts, runId, onLog });
      setResult({ directory: res.directory });
      if (cfg.rememberDirs) setCfg({ ...cfg, lastSmfDir: directory });
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
          Extract the source images (texture, heightmap, metal/type maps, features) from a Spring <code>.smf</code> into
          its folder.
        </p>
      </header>

      {probe && !probe.decompile && (
        <p className="flex items-start gap-2 border-b border-amber-500/40 bg-amber-500/10 px-6 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertCircle size={15} className="mt-px shrink-0" />
          The <code>mapdecompile</code> sidecar was not found. Bundle SpringMapConvNG or set{" "}
          <code>MAPCONV_MAPDECOMPILE_SIDECAR</code>.
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[28rem_1fr]">
        {/* Left: form */}
        <div className="min-h-0 space-y-5 overflow-auto border-r border-border px-6 py-5">
          <PathField
            label="Map file (.smf)"
            hint="source images are written next to it"
            value={smfPath}
            onChange={setSmfPath}
            disabled={running}
            filters={SMF_FILTERS}
            defaultPath={cfg.lastSmfDir}
          />
          {smfPath && (
            <Field label="Output folder" hint="the .smf's folder; mapdecompile writes here">
              <p className="rounded-md border border-border bg-card/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                {directory || "(current folder)"}
              </p>
            </Field>
          )}

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
        <div className="flex min-h-0 flex-col">
          {result && (
            <div className="flex items-start gap-2 border-b border-border bg-card/50 px-4 py-3 text-sm">
              <CheckCircle2 size={15} className="mt-px shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Extracted into <span className="font-mono text-xs">{result.directory}</span>
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
                <PackageOpen size={26} className="opacity-30" />
                <p>Decompile output streams here.</p>
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
