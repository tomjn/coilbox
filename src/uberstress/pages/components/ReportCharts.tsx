import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Report, ReportSummary } from "../../bindings";

// recharts renders to SVG and can't read CSS custom properties via `fill`, so the
// series palette is concrete hex chosen to read in both themes; axis/grid use
// currentColor with low opacity to follow the theme foreground.
const P50 = "#60a5fa";
const P95 = "#f59e0b";
const P99 = "#ef4444";
const RUN_A = "#6366f1";
const RUN_B = "#10b981";

const axisTick = { fontSize: 11, fill: "currentColor", opacity: 0.65 };
const gridStroke = "currentColor";

function shortTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Grouped p50/p95/p99 latency bars per command for one run. */
export function LatencyBars({ report }: { report: Report }) {
  const data = report.commands.map((c) => ({ command: c.command, p50: c.p50_ms, p95: c.p95_ms, p99: c.p99_ms }));
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.12} vertical={false} />
        <XAxis dataKey="command" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} unit="ms" />
        <Tooltip
          formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)} ms` : String(v ?? ""))}
          contentStyle={{ fontSize: 12, borderRadius: 6 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="p50" name="p50" fill={P50} radius={[2, 2, 0, 0]} />
        <Bar dataKey="p95" name="p95" fill={P95} radius={[2, 2, 0, 0]} />
        <Bar dataKey="p99" name="p99" fill={P99} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Per-command p99 comparison between two runs. */
export function CompareBars({
  a,
  b,
  labelA,
  labelB,
}: {
  a: Report;
  b: Report;
  labelA: string;
  labelB: string;
}) {
  // Union of command names, preserving run A's order then any extras from B.
  const names = [...a.commands.map((c) => c.command)];
  for (const c of b.commands) if (!names.includes(c.command)) names.push(c.command);
  const p99 = (r: Report, cmd: string) => r.commands.find((c) => c.command === cmd)?.p99_ms ?? 0;
  const data = names.map((cmd) => ({ command: cmd, a: p99(a, cmd), b: p99(b, cmd) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.12} vertical={false} />
        <XAxis dataKey="command" tick={axisTick} tickLine={false} axisLine={false} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} unit="ms" />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)} ms` : String(v ?? ""))} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="a" name={`${labelA} p99`} fill={RUN_A} radius={[2, 2, 0, 0]} />
        <Bar dataKey="b" name={`${labelB} p99`} fill={RUN_B} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** LOGIN/PING p99 trend across runs of one scenario, oldest → newest. */
export function TrendChart({ runs }: { runs: ReportSummary[] }) {
  // us_history is newest-first; reverse for a left-to-right time axis.
  const data = [...runs]
    .reverse()
    .map((r) => ({ when: shortTime(r.startedAt), login: r.loginP99Ms ?? null, ping: r.pingP99Ms ?? null }));
  const hasLogin = data.some((d) => d.login != null);
  const hasPing = data.some((d) => d.ping != null);
  if (data.length < 2 || (!hasLogin && !hasPing)) return null;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} opacity={0.12} />
        <XAxis dataKey="when" tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} unit="ms" />
        <Tooltip formatter={(v) => (typeof v === "number" ? `${v.toFixed(2)} ms` : String(v ?? ""))} contentStyle={{ fontSize: 12, borderRadius: 6 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {hasLogin && <Line type="monotone" dataKey="login" name="LOGIN p99" stroke={RUN_A} dot={false} connectNulls />}
        {hasPing && <Line type="monotone" dataKey="ping" name="PING p99" stroke={P95} dot={false} connectNulls />}
      </LineChart>
    </ResponsiveContainer>
  );
}
