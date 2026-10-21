import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { getVersion } from "@tauri-apps/api/app";
import { ClipboardCopy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type InfologTail,
  playInfolog,
  playSystemInfo,
  type SystemInfo,
} from "@/play/bindings";
import { usePreferredTarget } from "@/play/config";
import { EngineLogFile } from "./components/EngineLogFile";

/** "macos 14.5 (aarch64)", or without the version when the OS would not say. */
function describeSystem(s: SystemInfo): string {
  return `${[s.os, s.osVersion].filter(Boolean).join(" ")} (${s.arch})`;
}

/**
 * Where the engine's last log is, and what a helper asks for alongside it
 * (issues #379 and #4064).
 *
 * The page shows none of the log. Any slice of it reads as the whole file, and
 * the start, where the engine records its version, the system and the GPU, is
 * the part a slice leaves out. It points at the real file instead, so a player
 * can attach all of it.
 *
 * The engine writes the log to its own write dir rather than to the content
 * root, so this is also the quickest way to find out where that is.
 */
export default function EngineLogSection() {
  const { t } = useLingui();
  const { target } = usePreferredTarget();
  const dataDir = target?.dataDir;
  const [log, setLog] = useState<InfologTail | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (dataDir == null) return;
    setLoading(true);
    setCopied(false);
    try {
      // No lines: only the path and the time are wanted.
      const { log } = await playInfolog({ dataDir, maxLines: 0 });
      setLog(log);
      setError(null);
    } catch (e) {
      setLog(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [dataDir]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    playSystemInfo({})
      .then(setSystem)
      .catch(() => {});
    getVersion()
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  if (!target) {
    return (
      <p className="text-sm text-muted-foreground">
        <Trans>No engine is installed, so nothing has written a log yet.</Trans>
      </p>
    );
  }

  const rows: [string, string][] = [];
  if (system) rows.push([t`System`, describeSystem(system)]);
  if (appVersion) rows.push(["Coilbox", appVersion]);
  rows.push([t`Engine`, target.engineVersion]);

  const copySystemInfo = () => {
    const logPath = log?.path ?? t`none found`;
    const text = [
      ...rows.map(([k, v]) => `${k}: ${v}`),
      t`Log: ${logPath}`,
    ].join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  return (
    <div className="space-y-4">
      <EngineLogFile log={log}>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className="size-4" /> {loading ? t`Reading` : t`Reload`}
        </Button>
      </EngineLogFile>
      {log ? null : (
        <p className="text-sm text-muted-foreground">
          {error ?? t`Looking for the engine log.`}
        </p>
      )}

      <div className="space-y-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all">{v}</dd>
            </div>
          ))}
        </dl>
        <Button variant="outline" className="gap-1.5" onClick={copySystemInfo}>
          <ClipboardCopy className="size-4" />
          {copied ? t`Copied` : t`Copy system info`}
        </Button>
      </div>
    </div>
  );
}
