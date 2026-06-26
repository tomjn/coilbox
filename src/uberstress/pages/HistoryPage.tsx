import { Button, cn } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertCircle,
  Download,
  FolderOpen,
  History,
  Loader2,
  Play,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  type Report,
  type ReportSummary,
  usExportReport,
  usHistory,
  usImportReport,
  usReport,
  usResultsDir,
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

const ALL = "__all__";

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
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [serverFilter, setServerFilter] = useState(ALL);
  const location = useLocation();
  const navigate = useNavigate();

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

  // Open the results directory in the OS file manager.
  async function openFolder() {
    try {
      const { path } = await usResultsDir(undefined);
      await openPath(path);
    } catch (e) {
      setListError(errMessage(e));
    }
  }

  // Import an external report JSON into history, then select it.
  async function importReport() {
    try {
      const picked = await open({
        title: "Import a run report",
        multiple: false,
        filters: [{ name: "Report JSON", extensions: ["json"] }],
      });
      if (typeof picked !== "string") return;
      const { file } = await usImportReport({ src: picked });
      await loadHistory();
      await selectRun(file);
    } catch (e) {
      setListError(errMessage(e));
    }
  }

  // Export the selected run to a path the user picks.
  async function exportReport() {
    if (!selected) return;
    try {
      const dest = await save({
        title: "Export run report",
        defaultPath: selected,
        filters: [{ name: "Report JSON", extensions: ["json"] }],
      });
      if (!dest) return;
      await usExportReport({ file: selected, dest });
    } catch (e) {
      setReportError(errMessage(e));
    }
  }

  // Re-run this run's test: open the Run page prefilled with its scenario,
  // target, and params (the user picks/confirms the server and launches).
  function rerunTest() {
    if (!report) return;
    navigate("/uberstress", {
      state: {
        rerun: {
          scenario: report.scenario,
          addr: report.addr,
          params: report.params ?? {},
        },
      },
    });
  }

  // Filter the list by scenario ("type") and target address ("server").
  const allRuns = runs ?? [];
  const types = Array.from(new Set(allRuns.map((r) => r.scenario))).sort();
  const servers = Array.from(
    new Set(allRuns.map((r) => r.addr).filter(Boolean)),
  ).sort();
  const filteredRuns = allRuns.filter(
    (r) =>
      (typeFilter === ALL || r.scenario === typeFilter) &&
      (serverFilter === ALL || r.addr === serverFilter),
  );

  // Same-scenario runs power the trend chart and the compare picker.
  const sameScenario = report
    ? allRuns.filter((r) => r.scenario === report.scenario)
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
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={importReport}>
            <Upload /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={openFolder}>
            <FolderOpen /> Open folder
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[22rem_1fr]">
        {/* Left: run list */}
        <aside className="flex min-h-0 flex-col border-r border-border bg-card/30">
          <div className="flex items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Runs</span>
            {runs && (
              <span className="font-normal normal-case">
                {filteredRuns.length === allRuns.length
                  ? allRuns.length
                  : `${filteredRuns.length} / ${allRuns.length}`}
              </span>
            )}
          </div>
          {allRuns.length > 0 && (
            <div className="grid grid-cols-2 gap-2 border-b border-border/50 px-3 py-2">
              <OptionSelect
                size="sm"
                className="text-xs"
                value={typeFilter}
                onValueChange={setTypeFilter}
                options={[
                  { value: ALL, label: "All types" },
                  ...types.map((t) => ({ value: t, label: t })),
                ]}
              />
              <OptionSelect
                size="sm"
                className="text-xs"
                value={serverFilter}
                onValueChange={setServerFilter}
                options={[
                  { value: ALL, label: "All servers" },
                  ...servers.map((s) => ({ value: s, label: s })),
                ]}
              />
            </div>
          )}
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
            {allRuns.length > 0 && filteredRuns.length === 0 && (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No runs match the filters.
              </p>
            )}
            {filteredRuns.map((r) => (
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
                {r.addr && (
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {r.addr}
                  </span>
                )}
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
              <div className="flex items-start justify-between gap-4">
                <ReportHeader report={report} />
                <div className="flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={rerunTest}>
                    <Play /> Re-run
                  </Button>
                  <Button variant="outline" size="sm" onClick={exportReport}>
                    <Download /> Export
                  </Button>
                </div>
              </div>

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
