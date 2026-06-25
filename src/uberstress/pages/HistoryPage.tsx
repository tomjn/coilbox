import { cn } from "@picoframe/frame";
import { AlertCircle, History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import {
  type Report,
  type ReportSummary,
  usHistory,
  usReport,
} from "../bindings";
import { OptionSelect } from "./components/OptionSelect";
import {
  CompareBars,
  LatencyBars,
  TrendChart,
} from "./components/ReportCharts";
import {
  ConfigPanel,
  CountersPanel,
  EarlyTerminationNotice,
  fmtWhen,
  ReportHeader,
  SummaryBand,
} from "./components/ReportDetail";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Compact provenance line: ref or short SHA, server version. */
function provenance(s: ReportSummary): string {
  const tag = s.gitRef || s.commitSha?.slice(0, 12) || "adhoc";
  return s.serverVersion ? `${tag} · ${s.serverVersion}` : tag;
}

/** Per-command latency table for a selected run. */
function CommandTable({ report }: { report: Report }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2 pr-4 font-medium">Command</th>
          <th className="py-2 pr-4 text-right font-medium">Count</th>
          <th className="py-2 pr-4 text-right font-medium">Err</th>
          <th className="py-2 pr-4 text-right font-medium">p50</th>
          <th className="py-2 pr-4 text-right font-medium">p95</th>
          <th className="py-2 pr-4 text-right font-medium">p99</th>
          <th className="py-2 pr-4 text-right font-medium">max</th>
          <th className="py-2 text-right font-medium">/s</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {report.commands.map((c) => (
          <tr key={c.command} className="border-b border-border/50">
            <td className="py-1.5 pr-4 font-sans">{c.command}</td>
            <td className="py-1.5 pr-4 text-right">{c.count}</td>
            <td
              className={cn(
                "py-1.5 pr-4 text-right",
                (c.error_count ?? 0) > 0 && "text-destructive",
              )}
            >
              {c.error_count ?? 0}
            </td>
            <td className="py-1.5 pr-4 text-right">{c.p50_ms.toFixed(2)}</td>
            <td className="py-1.5 pr-4 text-right">{c.p95_ms.toFixed(2)}</td>
            <td className="py-1.5 pr-4 text-right">{c.p99_ms.toFixed(2)}</td>
            <td className="py-1.5 pr-4 text-right">{c.max_ms.toFixed(2)}</td>
            <td className="py-1.5 text-right">{c.per_second.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Browse saved run reports: list on the left, the selected run's data on the right. */
export default function HistoryPage() {
  const [runs, setRuns] = useState<ReportSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [compareFile, setCompareFile] = useState<string>("");
  const [compareReport, setCompareReport] = useState<Report | null>(null);
  const location = useLocation();

  const loadHistory = useCallback(async () => {
    setListError(null);
    try {
      const { runs } = await usHistory(undefined);
      setRuns(runs);
    } catch (e) {
      setListError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const selectRun = useCallback(async (file: string) => {
    setSelected(file);
    setReport(null);
    setReportError(null);
    setReportLoading(true);
    setCompareFile("");
    setCompareReport(null);
    try {
      const { report } = await usReport({ file });
      setReport(report);
    } catch (e) {
      setReportError(errMessage(e));
    } finally {
      setReportLoading(false);
    }
  }, []);

  // Arriving from the Run page's "View results": preselect that run.
  useEffect(() => {
    const file = (location.state as { selectFile?: string } | null)?.selectFile;
    if (file) selectRun(file);
  }, [location.state, selectRun]);

  async function selectCompare(file: string) {
    setCompareFile(file);
    setCompareReport(null);
    if (!file) return;
    try {
      const { report } = await usReport({ file });
      setCompareReport(report);
    } catch {
      // ignore: comparison is optional, leave the primary view intact
    }
  }

  // Same-scenario runs power the trend chart and the compare picker.
  const sameScenario = report
    ? (runs ?? []).filter((r) => r.scenario === report.scenario)
    : [];
  const compareOptions = sameScenario.filter((r) => r.file !== selected);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-4">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold leading-none">Run history</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Past load-test reports, newest first. Select a run to see its
            latency breakdown.
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[22rem_1fr]">
        {/* Left: run list */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-card/30">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Runs</span>
            {runs && (
              <span className="font-normal normal-case">{runs.length}</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {listError && (
              <p className="m-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle size={14} className="mt-px shrink-0" />
                {listError}
              </p>
            )}
            {runs?.length === 0 && !listError && (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
                <History size={28} className="opacity-40" />
                <p className="max-w-xs">
                  No runs yet. Run a load test to populate history.
                </p>
              </div>
            )}
            {runs?.map((r) => (
              <button
                type="button"
                key={r.file}
                onClick={() => selectRun(r.file)}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-border/50 px-4 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                  selected === r.file && "bg-accent text-accent-foreground",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">
                    {r.scenario}
                  </span>
                  {r.errorCount > 0 && (
                    <span className="shrink-0 rounded bg-destructive/15 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                      {r.errorCount} err
                    </span>
                  )}
                </div>
                <span className="truncate text-xs text-muted-foreground">
                  {provenance(r)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {fmtWhen(r.startedAt)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* Right: selected run detail */}
        <section className="flex min-h-0 flex-col overflow-auto">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">
              <History size={28} className="opacity-40" />
              <p className="max-w-xs">Select a run to view its data.</p>
            </div>
          ) : reportLoading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> loading report…
            </p>
          ) : reportError ? (
            <p className="m-6 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle size={15} className="mt-px shrink-0" />
              {reportError}
            </p>
          ) : report ? (
            <div className="space-y-6 p-6">
              <ReportHeader report={report} />

              <EarlyTerminationNotice report={report} />

              {/* Derived headline figures */}
              <SummaryBand report={report} />

              {/* Scenario knobs this run used */}
              {report.params && <ConfigPanel params={report.params} />}

              {/* Per-command latency */}
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Latency (p50 / p95 / p99)
                </h3>
                <LatencyBars report={report} />
              </div>

              {/* Compare against another run of the same scenario */}
              {compareOptions.length > 0 && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Compare p99 with
                    </h3>
                    <OptionSelect
                      value={compareFile}
                      onValueChange={selectCompare}
                      size="sm"
                      className="w-auto text-xs"
                      placeholder="Select a run…"
                      options={compareOptions.map((r) => ({
                        value: r.file,
                        label: `${r.gitRef || r.commitSha?.slice(0, 12) || "adhoc"} · ${fmtWhen(r.startedAt)}`,
                      }))}
                    />
                  </div>
                  {compareReport && (
                    <CompareBars
                      a={report}
                      b={compareReport}
                      labelA={
                        report.ref || report.commit_sha?.slice(0, 8) || "this"
                      }
                      labelB={
                        compareReport.ref ||
                        compareReport.commit_sha?.slice(0, 8) ||
                        "other"
                      }
                    />
                  )}
                </div>
              )}

              {/* Trend of this scenario across runs */}
              {sameScenario.length >= 2 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {report.scenario} p99 trend
                  </h3>
                  <TrendChart runs={sameScenario} />
                </div>
              )}

              <CommandTable report={report} />

              <CountersPanel counters={report.counters} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
