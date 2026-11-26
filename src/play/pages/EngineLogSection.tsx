import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { getVersion } from "@tauri-apps/api/app";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ClipboardCopy,
  ExternalLink,
  FolderSearch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { HelpPopover } from "@/components/HelpPopover";
import { SettingList, SettingRow } from "@/components/SettingRow";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { contentOpenPath } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import { formatDateTime } from "@/lib/format";
import {
  type InfologTail,
  playInfolog,
  playSystemInfo,
  type SystemInfo,
} from "@/play/bindings";
import { usePreferredTarget } from "@/play/config";
import { describeSystem } from "@/play/crash";

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
  const {
    target,
    loading: targetLoading,
    error: targetError,
  } = usePreferredTarget();
  const dataDir = target?.dataDir;
  const [log, setLog] = useState<InfologTail | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (dataDir == null) return;
    setLoading(true);
    setOpenError(null);
    try {
      // No lines: only the path and the time are wanted.
      const { log } = await playInfolog({ dataDir, maxLines: 0 });
      setLog(log);
      setError(null);
    } catch (e) {
      setLog(null);
      setError(describeError(e));
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
        {targetLoading ? (
          <Trans>Looking for installed engines.</Trans>
        ) : targetError ? (
          targetError
        ) : (
          <Trans>
            No engine is installed, so nothing has written a log yet.
          </Trans>
        )}
      </p>
    );
  }

  const rows: [string, string][] = [];
  if (system) rows.push([t`System`, describeSystem(system)]);
  if (appVersion) rows.push(["Coilbox", appVersion]);
  rows.push([t`Engine`, target.engineVersion]);
  const writtenAt = log ? formatDateTime(new Date(log.modifiedMs)) : "";

  const copySystemInfo = () => {
    const logPath = log?.path ?? t`none found`;
    const text = [
      ...rows.map(([k, v]) => `${k}: ${v}`),
      t`Log: ${logPath}`,
    ].join("\n");
    setCopyError(null);
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((e) => setCopyError(describeError(e)));
  };

  const openLog = (path: string) => {
    setOpenError(null);
    contentOpenPath({ path }).catch((e) => setOpenError(describeError(e)));
  };

  const showLog = (path: string) => {
    setOpenError(null);
    revealItemInDir(path).catch((e) => setOpenError(describeError(e)));
  };

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-1">
          <h2 className="text-sm font-semibold">
            <Trans>Log file</Trans>
          </h2>
          <HelpPopover label={t`About the engine log`}>
            <p>
              <Trans>
                When you ask for help with a crash, attach the whole file. Its
                start records the engine version, the system and the graphics
                card.
              </Trans>
            </p>
          </HelpPopover>
        </div>
        <SettingList>
          <SettingRow
            label="infolog.txt"
            description={
              log ? (
                <>
                  <code className="block select-text break-all">
                    {log.path}
                  </code>
                  <Trans>Written {writtenAt}</Trans>
                </>
              ) : (
                (error ?? t`Looking for the engine log.`)
              )
            }
            error={openError}
          >
            <TooltipProvider>
              <div className="flex items-center gap-1">
                <IconButton
                  label={t`Look for the log again`}
                  onClick={() => void load()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </IconButton>
                {log && (
                  <>
                    <IconButton
                      label={t`Open the log file`}
                      onClick={() => openLog(log.path)}
                    >
                      <ExternalLink className="size-4" />
                    </IconButton>
                    <IconButton
                      label={t`Show in folder`}
                      onClick={() => showLog(log.path)}
                    >
                      <FolderSearch className="size-4" />
                    </IconButton>
                  </>
                )}
              </div>
            </TooltipProvider>
          </SettingRow>
        </SettingList>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            <Trans>System</Trans>
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copySystemInfo}
          >
            <ClipboardCopy className="size-4" />
            {copied ? t`Copied` : t`Copy system info`}
          </Button>
        </div>
        {copyError && (
          <p
            role="alert"
            className="select-text break-words text-xs text-destructive"
          >
            {copyError}
          </p>
        )}
        <SettingList>
          {rows.map(([k, v]) => (
            <SettingRow key={k} label={k}>
              <span className="select-text text-sm">{v}</span>
            </SettingRow>
          ))}
        </SettingList>
      </section>
    </div>
  );
}

/** A ghost icon button named by its tooltip, as on the Engines page. */
function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
