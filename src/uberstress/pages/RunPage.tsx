import { Button, Input, cn } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  Play,
  Square,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type Config,
  type LogLine,
  type Report,
  type RunOpts,
  usCancel,
  usConfigGet,
  usRun,
  usScenarios,
} from "../bindings";
import { CheckField, Field } from "./components/Field";
import SeedSqlDialog from "./components/SeedSqlDialog";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const MANUAL = "__manual__";

/** Headline metrics for the just-finished run. */
function ResultSummary({ report, file }: { report: Report; file: string }) {
  const headline = report.commands.filter((c) => c.command === "LOGIN" || c.command === "PING");
  return (
    <div className="space-y-3 rounded-md border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Run complete</h3>
        <span className="text-xs text-muted-foreground">
          {report.duration_sec.toFixed(1)}s · saved to history ({file})
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {(headline.length > 0 ? headline : report.commands.slice(0, 3)).map((c) => (
          <div key={c.command} className="space-y-0.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{c.command} p99</p>
            <p className="font-mono">{c.p99_ms.toFixed(2)} ms</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Open the History page for the full breakdown and charts.</p>
    </div>
  );
}

/** Drive a load/bench test against a server, streaming live output. */
export default function RunPage() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [configError, setConfigError] = useState<string | null>(null);

  const [mode, setMode] = useState<"load" | "bench">("load");
  const [serverChoice, setServerChoice] = useState<string>(MANUAL);
  const [manualAddr, setManualAddr] = useState("127.0.0.1:8200");
  const [launch, setLaunch] = useState(true);

  // Core knobs.
  const [scenario, setScenario] = useState("login-storm");
  const [conns, setConns] = useState(100);
  const [duration, setDuration] = useState("30s");
  const [ramp, setRamp] = useState("10s");
  const [register, setRegister] = useState(true);
  const [refLabel, setRefLabel] = useState("");

  // Advanced knobs (default to uberstress's own defaults, so passing them is a no-op).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [userPrefix, setUserPrefix] = useState("uberstress_");
  const [password, setPassword] = useState("stresspw");
  const [channel, setChannel] = useState("stress");
  const [channels, setChannels] = useState(1);
  const [sayInterval, setSayInterval] = useState("1s");
  const [battleHosts, setBattleHosts] = useState(10);
  const [pingers, setPingers] = useState(2);
  const [pingInterval, setPingInterval] = useState("200ms");
  const [compareTo, setCompareTo] = useState("");

  const [running, setRunning] = useState(false);
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [result, setResult] = useState<{ report: Report; file: string } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [showSql, setShowSql] = useState(false);

  const runIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Load config + scenarios; seed the form from saved defaults.
  useEffect(() => {
    (async () => {
      try {
        const { config } = await usConfigGet(undefined);
        setCfg(config);
        setScenario(config.defaults.scenario);
        setConns(config.defaults.conns);
        setDuration(config.defaults.duration);
        setRamp(config.defaults.ramp);
        if (config.servers.length > 0) setServerChoice(config.servers[0].id);
      } catch (e) {
        setConfigError(errMessage(e));
      }
      try {
        const { scenarios } = await usScenarios(undefined);
        setScenarios(scenarios);
      } catch {
        // best-effort; scenario falls back to free text
      }
    })();
  }, []);

  // Auto-scroll the log to the newest line.
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logLines]);

  const effectiveAddr =
    serverChoice === MANUAL ? manualAddr : (cfg?.servers.find((s) => s.id === serverChoice)?.addr ?? manualAddr);

  // load always needs an addr; bench needs one only when not launching locally.
  const needsAddr = mode === "load" || (mode === "bench" && !launch);
  const canRun = !running && (!needsAddr || effectiveAddr.trim().length > 0) && scenario.trim().length > 0;

  function buildOpts(): RunOpts {
    const opts: RunOpts = {
      mode,
      addr: effectiveAddr.trim(),
      scenario,
      conns,
      duration,
      ramp,
      register,
      userPrefix,
      password,
      channel,
      channels,
      sayInterval,
      battleHosts,
      pingers,
      pingInterval,
      refLabel: refLabel.trim() || undefined,
    };
    if (mode === "bench" && cfg) {
      opts.launch = launch;
      opts.serverDir = cfg.bench.serverDir;
      opts.serverPython = cfg.bench.serverPython;
      opts.port = cfg.bench.port;
      opts.natport = cfg.bench.natport;
      opts.db = cfg.bench.db;
      opts.dbReset = cfg.bench.dbReset;
      if (compareTo.trim()) opts.compareTo = compareTo.trim();
    }
    return opts;
  }

  // Plain function (not memoized): it reads current form state via buildOpts, so
  // it must close over the latest render, not a stale one.
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
      const res = await usRun({ opts: buildOpts(), runId, onLog });
      setResult({ report: res.report, file: res.reportFile });
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
        await usCancel({ runId: runIdRef.current });
      } catch {
        // the run promise will settle with its own error
      }
    }
  }

  const scenarioInput =
    scenarios.length > 0 ? (
      <select
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        disabled={running}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {scenarios.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    ) : (
      <Input value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={running} />
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <Zap size={18} /> Run load test
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Drive a scenario against a lobby server (load) or launch one locally and benchmark it (bench).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSql(true)}>
          <Database /> Seed SQL
        </Button>
      </header>

      {configError && (
        <p className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-6 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="mt-px shrink-0" />
          {configError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[28rem_1fr]">
        {/* Left: form */}
        <div className="min-h-0 space-y-5 overflow-auto border-r border-border px-6 py-5">
          {/* Mode toggle */}
          <div className="inline-flex rounded-md border border-border p-0.5 text-sm">
            {(["load", "bench"] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={running}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded px-3 py-1 capitalize transition-colors",
                  mode === m ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Target */}
          {mode === "bench" && (
            <CheckField
              label="Launch a local server"
              hint="Uses the bench/DB settings on the Servers page. Uncheck to benchmark an external address."
              checked={launch}
              onChange={setLaunch}
            />
          )}
          {needsAddr && (
            <div className="space-y-2">
              <Field label="Target server">
                <select
                  value={serverChoice}
                  onChange={(e) => setServerChoice(e.target.value)}
                  disabled={running}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {cfg?.servers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.addr} ({s.addr})
                    </option>
                  ))}
                  <option value={MANUAL}>Manual address…</option>
                </select>
              </Field>
              {serverChoice === MANUAL && (
                <Field label="Address">
                  <Input
                    value={manualAddr}
                    onChange={(e) => setManualAddr(e.target.value)}
                    placeholder="127.0.0.1:8200"
                    disabled={running}
                    className="font-mono text-xs"
                  />
                </Field>
              )}
            </div>
          )}

          {/* Core knobs */}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Scenario" className="col-span-2">
              {scenarioInput}
            </Field>
            <Field label="Connections">
              <Input
                type="number"
                min={1}
                value={conns}
                onChange={(e) => setConns(Number(e.target.value))}
                disabled={running}
              />
            </Field>
            <Field label="Ref label" hint="optional; tags the report">
              <Input value={refLabel} onChange={(e) => setRefLabel(e.target.value)} disabled={running} />
            </Field>
            <Field label="Duration" hint="e.g. 30s">
              <Input
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                disabled={running}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="Ramp" hint="e.g. 10s">
              <Input
                value={ramp}
                onChange={(e) => setRamp(e.target.value)}
                disabled={running}
                className="font-mono text-xs"
              />
            </Field>
          </div>
          <CheckField
            label="Seed accounts before the timed phase (register)"
            hint="Turn off if you pre-seeded accounts with the Seed SQL button."
            checked={register}
            onChange={setRegister}
          />

          {/* Advanced */}
          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {showAdvanced ? <ChevronDown size={15} /> : <ChevronRight size={15} />} Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Field label="User prefix">
                  <Input value={userPrefix} onChange={(e) => setUserPrefix(e.target.value)} disabled={running} />
                </Field>
                <Field label="Password">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} disabled={running} />
                </Field>
                <Field label="Channel" hint="chat scenarios">
                  <Input value={channel} onChange={(e) => setChannel(e.target.value)} disabled={running} />
                </Field>
                <Field label="Channels">
                  <Input
                    type="number"
                    min={1}
                    value={channels}
                    onChange={(e) => setChannels(Number(e.target.value))}
                    disabled={running}
                  />
                </Field>
                <Field label="Say interval">
                  <Input value={sayInterval} onChange={(e) => setSayInterval(e.target.value)} disabled={running} />
                </Field>
                <Field label="Battle hosts">
                  <Input
                    type="number"
                    min={0}
                    value={battleHosts}
                    onChange={(e) => setBattleHosts(Number(e.target.value))}
                    disabled={running}
                  />
                </Field>
                <Field label="Pingers">
                  <Input
                    type="number"
                    min={0}
                    value={pingers}
                    onChange={(e) => setPingers(Number(e.target.value))}
                    disabled={running}
                  />
                </Field>
                <Field label="Ping interval">
                  <Input value={pingInterval} onChange={(e) => setPingInterval(e.target.value)} disabled={running} />
                </Field>
                {mode === "bench" && (
                  <Field label="Compare to" hint="path to a prior report.json" className="col-span-2">
                    <Input
                      value={compareTo}
                      onChange={(e) => setCompareTo(e.target.value)}
                      disabled={running}
                      className="font-mono text-xs"
                    />
                  </Field>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            {running ? (
              <Button variant="outline" onClick={cancel}>
                <Square /> Cancel
              </Button>
            ) : (
              <Button onClick={run} disabled={!canRun}>
                <Play /> Run test
              </Button>
            )}
            {running && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> running…
              </span>
            )}
          </div>
        </div>

        {/* Right: live log + result */}
        <div className="flex min-h-0 flex-col">
          {result && (
            <div className="border-b border-border p-4">
              <ResultSummary report={result.report} file={result.file} />
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
                <Zap size={26} className="opacity-30" />
                <p>Run output streams here.</p>
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

      {showSql && (
        <SeedSqlDialog
          defaultCount={Math.max(conns, 2000)}
          defaultPrefix={userPrefix}
          defaultPassword={password}
          onClose={() => setShowSql(false)}
        />
      )}
    </div>
  );
}
