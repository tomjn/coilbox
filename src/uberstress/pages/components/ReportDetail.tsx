import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@picoframe/frame";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDateTime, formatFixed, formatNumber } from "@/lib/format";
import type { Report } from "../../bindings";
import {
  detectEarlyTermination,
  isErrorCounter,
  parseGreeting,
  summarize,
} from "../../reportMetrics";

/** Format an ISO timestamp for display, falling back to the raw string. */
export function fmtWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : formatDateTime(d);
}

/** Prettify a params/counter key: `say_interval` -> `say interval`. Known config keys get a display label. */
function prettyKey(key: string): string {
  switch (key) {
    case "conns":
      return t`Concurrent connections`;
    case "duration":
      return t`Hold time`;
    case "ramp":
      return t`Ramp`;
    default:
      return key.replace(/_/g, " ");
  }
}

/** Run identity: scenario, address, when, and provenance (ref / commit / server greeting). */
export function ReportHeader({ report }: { report: Report }) {
  const greeting = report.server_version
    ? parseGreeting(report.server_version)
    : null;
  const sha = report.commit_sha?.slice(0, 12);
  const protocolVersion = greeting?.fields?.protocolVersion;
  const udpPort = greeting?.fields?.udpPort;
  const serverMode = greeting?.fields?.serverMode;
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">
        {report.scenario}{" "}
        <span className="font-normal text-muted-foreground">
          · {report.addr}
        </span>
      </h2>
      <p className="text-sm text-muted-foreground">
        {fmtWhen(report.started_at)} · {formatFixed(report.duration_sec, 1)}s
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {report.ref && (
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
            {report.ref}
          </span>
        )}
        {sha && <span className="font-mono text-muted-foreground">{sha}</span>}
        {greeting &&
          (greeting.fields ? (
            <span className="text-muted-foreground" title={greeting.raw}>
              <Trans>
                TASSERVER v{protocolVersion} · UDP {udpPort} · mode {serverMode}
              </Trans>
            </span>
          ) : (
            <span className="font-mono text-muted-foreground">
              {greeting.raw}
            </span>
          ))}
      </div>
    </div>
  );
}

/** A single headline figure in the summary band. */
function Stat({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "error";
}) {
  return (
    <div className="rounded-md border border-border bg-card/50 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-lg leading-tight",
          emphasis === "error" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Derived headline figures across the whole run. */
export function SummaryBand({ report }: { report: Report }) {
  const { t } = useLingui();
  const s = summarize(report);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label={t`Requests`} value={formatNumber(s.totalRequests)} />
      <Stat label={t`Throughput`} value={`${formatFixed(s.throughput, 1)}/s`} />
      <Stat
        label={t`Errors`}
        value={formatNumber(s.totalErrors)}
        emphasis={s.totalErrors > 0 ? "error" : undefined}
      />
      <Stat
        label={t`Success`}
        value={
          s.successRate === null
            ? "—"
            : `${formatFixed(s.successRate * 100, 1)}%`
        }
      />
      <Stat label={t`Elapsed`} value={`${formatFixed(s.durationSec, 1)}s`} />
    </div>
  );
}

/**
 * Warns when a run ended well short of its requested window because connections
 * failed (e.g. logins denied), so the hold phase never ran. Renders nothing for
 * healthy runs. Shown on both the Run result and the History detail.
 */
export function EarlyTerminationNotice({ report }: { report: Report }) {
  const early = detectEarlyTermination(report);
  if (!early) return null;
  const top = early.failedCommands[0];
  const actual = formatFixed(early.actualSec, 1);
  const expected = formatFixed(early.expectedSec, 0);
  const errors = top?.errors ?? 0;
  const command = top?.command ?? "";
  return (
    <Alert variant="warning">
      <AlertTriangle size={15} />
      <AlertTitle className="line-clamp-none">
        <Trans>
          Run ended early — {actual}s of the requested ~{expected}s window.
        </Trans>
      </AlertTitle>
      <AlertDescription>
        {top ? (
          plural(errors, {
            one: `# ${command} attempt failed, so connections didn't stay open to sustain the hold.`,
            other: `# ${command} attempts failed, so connections didn't stay open to sustain the hold.`,
          })
        ) : (
          <Trans>Connections didn't stay open to sustain the hold.</Trans>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The scenario knobs the run was launched with (from the report's params map). */
export function ConfigPanel({ params }: { params: Record<string, string> }) {
  const entries = Object.entries(params);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Trans>Configuration</Trans>
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3 lg:grid-cols-4">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col">
            <dt className="text-xs capitalize text-muted-foreground">
              {prettyKey(k)}
            </dt>
            <dd className="font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Event counters as chips, with error-type counters visually distinguished. */
export function CountersPanel({
  counters,
}: {
  counters: Record<string, number>;
}) {
  const entries = Object.entries(counters);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Trans>Counters</Trans>
      </h3>
      <div className="flex flex-wrap gap-2 font-mono text-xs">
        {entries.map(([k, v]) => {
          const isErr = isErrorCounter(k) && v > 0;
          return (
            <span
              key={k}
              className={cn(
                "rounded px-2 py-1",
                isErr
                  ? "bg-destructive/15 text-destructive"
                  : "bg-muted text-foreground",
              )}
            >
              {k}={v}
            </span>
          );
        })}
      </div>
    </div>
  );
}
