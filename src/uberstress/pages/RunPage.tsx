import { Button, cn, Input, useDrawer } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import {
  AlertCircle,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Database,
  Loader2,
  Play,
  Square,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  type LogLine,
  type Report,
  type RunOpts,
  usCancel,
  usRun,
  usScenarios,
} from "../bindings";
import { useUberstressConfig } from "../config";
import {
  parseDurationSec,
  parseProgressLine,
  type RunProgress as RunProgressData,
} from "../reportMetrics";
import { CheckField, Field } from "./components/Field";
import { OptionSelect } from "./components/OptionSelect";
import { EarlyTerminationNotice } from "./components/ReportDetail";
import SeedSqlForm from "./components/SeedSqlForm";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const MANUAL = "__manual__";

/** Headline metrics for the just-finished run. */
function ResultSummary({ report, file }: { report: Report; file: string }) {
  const headline = report.commands.filter(
    (c) => c.command === "LOGIN" || c.command === "PING",
  );
  return (
    <div className="space-y-3 rounded-md border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Run complete</h3>
        <span className="text-xs text-muted-foreground">
          {report.duration_sec.toFixed(1)}s · saved to history ({file})
        </span>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {(headline.length > 0 ? headline : report.commands.slice(0, 3)).map(
          (c) => (
            <div key={c.command} className="space-y-0.5">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {c.command} p99
              </p>
              <p className="font-mono">{c.p99_ms.toFixed(2)} ms</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function phaseLabel(elapsed: number, rampSec: number, durSec: number): string {
  if (elapsed < rampSec) return "ramping up";
  if (elapsed < rampSec + durSec) return "steady load";
  return "finishing";
}

/** One live telemetry figure under the progress bar. */
function LiveStat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("ml-1.5 font-mono", emphasis && "text-destructive")}>
        {value}
      </span>
    </div>
  );
}

/**
 * Progress shown while a run is in flight. The bar is time-based (derived from
 * the configured ramp + duration). Once the sidecar emits live telemetry it is
 * shown beneath the bar, superseding the time estimate as the source of truth.
 */
function RunProgress({
  elapsed,
  rampSec,
  durSec,
  live,
}: {
  elapsed: number;
  rampSec: number | null;
  durSec: number | null;
  live: RunProgressData | null;
}) {
  const windowSec = rampSec != null && durSec != null ? rampSec + durSec : null;
  const pct = windowSec ? Math.min((elapsed / windowSec) * 100, 100) : null;
  const phase =
    rampSec != null && durSec != null
      ? phaseLabel(elapsed, rampSec, durSec)
      : "running";
  return (
    <div className="space-y-2 border-b border-border p-4">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin" /> {phase}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {elapsed.toFixed(0)}s{windowSec ? ` / ~${windowSec.toFixed(0)}s` : ""}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
        {pct === null ? (
          <div className="h-full w-1/3 animate-pulse rounded bg-accent" />
        ) : (
          <div
            className="h-full rounded bg-accent transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {live ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <LiveStat label="Sent" value={live.sent.toLocaleString()} />
          <LiveStat label="Rate" value={`${live.rate.toFixed(0)}/s`} />
          <LiveStat
            label="Errors"
            value={live.errors.toLocaleString()}
            emphasis={live.errors > 0}
          />
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Estimated from ramp + duration; live metrics appear once the run is
          under way.
        </p>
      )}
    </div>
  );
}

/** Drive a load/bench test against a server, streaming live output. */
export default function RunPage() {
  // Config is reactive from the frame settings store; seeds the form below.
  const [cfg] = useUberstressConfig();
  const drawer = useDrawer();
  const navigate = useNavigate();
  const location = useLocation();
  const [scenarios, setScenarios] = useState<string[]>([]);

  const [mode, setMode] = useState<"load" | "bench">("load");
  const [serverChoice, setServerChoice] = useState<string>(
    () => cfg.servers[0]?.id ?? MANUAL,
  );
  const [manualAddr, setManualAddr] = useState("127.0.0.1:8200");
  const [launch, setLaunch] = useState(true);

  // Core knobs, seeded once from saved defaults.
  const [scenario, setScenario] = useState(() => cfg.defaults.scenario);
  const [conns, setConns] = useState(() => cfg.defaults.conns);
  const [duration, setDuration] = useState(() => cfg.defaults.duration);
  const [ramp, setRamp] = useState(() => cfg.defaults.ramp);
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
  const [result, setResult] = useState<{ report: Report; file: string } | null>(
    null,
  );
  const [runError, setRunError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<RunProgressData | null>(null);
  const [showLog, setShowLog] = useState(true);

  const runIdRef = useRef<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Populate the scenario dropdown (best-effort; falls back to free text).
  useEffect(() => {
    usScenarios(undefined)
      .then(({ scenarios }) => setScenarios(scenarios))
      .catch(() => {});
  }, []);

  // Prefill from a History "Re-run": apply the saved scenario, target, and
  // params once, then let the user pick the server and launch.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current) return;
    const rr = (
      location.state as {
        rerun?: {
          scenario: string;
          addr: string;
          params: Record<string, string>;
        };
      } | null
    )?.rerun;
    if (!rr) return;
    prefilled.current = true;

    setScenario(rr.scenario);
    const match = cfg.servers.find((s) => s.addr === rr.addr);
    if (match) {
      setServerChoice(match.id);
    } else if (rr.addr) {
      setServerChoice(MANUAL);
      setManualAddr(rr.addr);
    }

    const p = rr.params ?? {};
    const setNum = (k: string, set: (n: number) => void) => {
      const v = p[k];
      if (v != null && v !== "") set(Number(v));
    };
    const setStr = (k: string, set: (s: string) => void) => {
      const v = p[k];
      if (v != null) set(v);
    };
    setNum("conns", setConns);
    setStr("duration", setDuration);
    setStr("ramp", setRamp);
    if (p.register != null) setRegister(p.register !== "false");
    setStr("user_prefix", setUserPrefix);
    setStr("password", setPassword);
    setStr("channel", setChannel);
    setNum("channels", setChannels);
    setStr("say_interval", setSayInterval);
    setNum("battle_hosts", setBattleHosts);
    setNum("pingers", setPingers);
    setStr("ping_interval", setPingInterval);
    const advancedKeys = [
      "user_prefix",
      "password",
      "channel",
      "channels",
      "say_interval",
      "battle_hosts",
      "pingers",
      "ping_interval",
    ];
    if (advancedKeys.some((k) => p[k] != null)) setShowAdvanced(true);
  }, [location.state, cfg.servers]);

  // Auto-scroll the log to the newest line.
  // biome-ignore lint/correctness/useExhaustiveDependencies: logLines is the trigger that should re-run the scroll, not read in the body
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logLines]);

  // Tick an elapsed-time estimate while a run is in flight.
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed((Date.now() - start) / 1000), 250);
    return () => clearInterval(id);
  }, [running]);

  const rampSec = parseDurationSec(ramp);
  const durSec = parseDurationSec(duration);

  const effectiveAddr =
    serverChoice === MANUAL
      ? manualAddr
      : (cfg.servers.find((s) => s.id === serverChoice)?.addr ?? manualAddr);

  // load always needs an addr; bench needs one only when not launching locally.
  const needsAddr = mode === "load" || (mode === "bench" && !launch);
  const canRun =
    !running &&
    (!needsAddr || effectiveAddr.trim().length > 0) &&
    scenario.trim().length > 0;

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
    if (mode === "bench") {
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
    setProgress(null);
    const runId = crypto.randomUUID();
    runIdRef.current = runId;
    const onLog = new Channel<LogLine>();
    onLog.onmessage = (line) => {
      const p = parseProgressLine(line.line);
      if (p) {
        setProgress(p);
        return;
      }
      setLogLines((prev) => [...prev, line]);
    };
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
      <OptionSelect
        value={scenario}
        onValueChange={setScenario}
        disabled={running}
        options={scenarios.map((s) => ({ value: s, label: s }))}
      />
    ) : (
      <Input
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        disabled={running}
      />
    );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold leading-none">
            <Zap size={18} /> Run load test
          </h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Drive a scenario against a lobby server (load) or launch one locally
            and benchmark it (bench).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            drawer.open({
              title: "Generate seed SQL",
              description:
                "Pre-seed accounts so a load test can run with registration off.",
              width: "44rem",
              content: (
                <SeedSqlForm
                  defaultCount={Math.max(conns, 2000)}
                  defaultPrefix={userPrefix}
                  defaultPassword={password}
                />
              ),
            })
          }
        >
          <Database /> Seed SQL
        </Button>
      </header>

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
                  mode === m
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
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
                <OptionSelect
                  value={serverChoice}
                  onValueChange={setServerChoice}
                  disabled={running}
                  options={[
                    ...cfg.servers.map((s) => ({
                      value: s.id,
                      label: `${s.name || s.addr} (${s.addr})`,
                    })),
                    { value: MANUAL, label: "Manual address…" },
                  ]}
                />
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
            <Field label="Concurrent connections">
              <Input
                type="number"
                min={1}
                value={conns}
                onChange={(e) => setConns(Number(e.target.value))}
                disabled={running}
              />
            </Field>
            <Field label="Ref label" hint="optional; tags the report">
              <Input
                value={refLabel}
                onChange={(e) => setRefLabel(e.target.value)}
                disabled={running}
              />
            </Field>
            <Field
              label="Hold time"
              hint="hold connections after login, e.g. 30s"
            >
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
              {showAdvanced ? (
                <ChevronDown size={15} />
              ) : (
                <ChevronRight size={15} />
              )}{" "}
              Advanced options
            </button>
            {showAdvanced && (
              <div className="mt-3 grid grid-cols-2 gap-4">
                <Field label="User prefix">
                  <Input
                    value={userPrefix}
                    onChange={(e) => setUserPrefix(e.target.value)}
                    disabled={running}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={running}
                  />
                </Field>
                <Field label="Channel" hint="chat scenarios">
                  <Input
                    value={channel}
                    onChange={(e) => setChannel(e.target.value)}
                    disabled={running}
                  />
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
                  <Input
                    value={sayInterval}
                    onChange={(e) => setSayInterval(e.target.value)}
                    disabled={running}
                  />
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
                  <Input
                    value={pingInterval}
                    onChange={(e) => setPingInterval(e.target.value)}
                    disabled={running}
                  />
                </Field>
                {mode === "bench" && (
                  <Field
                    label="Compare to"
                    hint="path to a prior report.json"
                    className="col-span-2"
                  >
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
          {running && (
            <RunProgress
              elapsed={elapsed}
              rampSec={rampSec}
              durSec={durSec}
              live={progress}
            />
          )}
          {result && (
            <div className="space-y-3 border-b border-border p-4">
              <ResultSummary report={result.report} file={result.file} />
              <EarlyTerminationNotice report={result.report} />
              <Button
                size="sm"
                onClick={() =>
                  navigate("/uberstress/history", {
                    state: { selectFile: result.file },
                  })
                }
              >
                <BarChart3 /> View results
              </Button>
            </div>
          )}
          {runError && (
            <p className="flex items-start gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={15} className="mt-px shrink-0" />
              {runError}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            {showLog ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Output
            {logLines.length > 0 && (
              <span className="font-normal normal-case">
                ({logLines.length} lines)
              </span>
            )}
          </button>
          {showLog && (
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
          )}
        </div>
      </div>
    </div>
  );
}
