import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { useState } from "react";
import { CheckField } from "@/components/Field";
import { Progress } from "@/components/ui/progress";
import { describeError } from "@/i18n/uiError";
import { formatBytes } from "@/lib/format";
import { usePreferredTarget } from "@/play/config";
import { isHubAssetUploadOffered } from "@/profile/profile";
import { useHubAccount } from "../../account";
import {
  type BulkFindProgress,
  type BulkFindResult,
  type BulkItemStatus,
  findMissingMaps,
  runBulkUpload,
  stopBulkUpload,
  useBulkRun,
} from "../../upload/bulkMaps";

/**
 * Uploading every map file the hub is missing, in Settings > Coilbox hub.
 *
 * Finding reads and hashes each missing map, which is slow on a large library,
 * so it waits for a press. Nothing is sent until the Upload press, which is
 * the agreement for every map ticked, as one press is for a single map. It
 * covers each map's facts as well as its file. The uploading itself is
 * `runBulkUpload`, which carries on if this page closes.
 */
export function MapArchivesControl({ hubUrl }: { hubUrl: string }) {
  const { t } = useLingui();
  const account = useHubAccount(hubUrl);
  const { target } = usePreferredTarget();
  const run = useBulkRun();
  const [progress, setProgress] = useState<BulkFindProgress | null>(null);
  const [found, setFound] = useState<BulkFindResult | null>(null);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<string | null>(null);

  if (!account.signedIn || !isHubAssetUploadOffered()) return null;

  const find = async () => {
    if (!target?.enginePath) return;
    setFound(null);
    setFailed(null);
    setUnticked(new Set());
    setProgress({ phase: "asking" });
    try {
      setFound(
        await findMissingMaps(
          { hubUrl, enginePath: target.enginePath, dataDir: target.dataDir },
          setProgress,
        ),
      );
    } catch (e) {
      setFailed(describeError(e));
    } finally {
      setProgress(null);
    }
  };

  const chosen =
    found?.candidates.filter((one) => !unticked.has(one.mapName)) ?? [];
  const upload = () => {
    if (!target?.enginePath) return;
    setFound(null);
    void runBulkUpload(
      { hubUrl, enginePath: target.enginePath, dataDir: target.dataDir },
      chosen,
    );
  };
  const tick = (mapName: string, on: boolean) =>
    setUnticked((held) => {
      const next = new Set(held);
      if (on) next.delete(mapName);
      else next.add(mapName);
      return next;
    });

  const statusWords: Record<BulkItemStatus, string> = {
    waiting: t`Waiting`,
    sending: t`Uploading`,
    listed: t`On the hub`,
    failed: t`Failed`,
    stopped: t`Stopped`,
  };
  const showRun = run && !found && !progress;
  const finished = run?.items.filter(
    (item) => item.status !== "waiting" && item.status !== "sending",
  ).length;
  const size = formatBytes(
    chosen.reduce((sum, one) => sum + one.facts.size, 0),
  );
  const count = chosen.length;

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium leading-none">
        <Trans>Uploading your map files</Trans>
      </h3>
      <div className="flex items-center gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void find()}
          disabled={!!progress || !!run?.running || !target?.enginePath}
        >
          {progress ? t`Finding maps…` : t`Find maps the hub is missing`}
        </Button>
        {progress && (
          <span className="text-sm text-muted-foreground">
            {progress.phase === "asking"
              ? t`Asking the hub about your maps`
              : t`Read ${progress.done} of ${progress.total}`}
          </span>
        )}
      </div>
      {progress?.phase === "reading" && (
        <Progress
          value={
            progress.total > 0
              ? Math.round((progress.done / progress.total) * 100)
              : 0
          }
          className="h-1.5 bg-muted"
          aria-label={t`Reading your maps`}
        />
      )}
      {!target?.enginePath && (
        <p className="text-sm text-muted-foreground">
          <Trans>
            Coilbox needs an engine installed before it can read your maps.
          </Trans>
        </p>
      )}
      {failed && <p className="text-sm text-destructive">{failed}</p>}

      {found && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            <Trans>
              {found.candidates.length} can be uploaded, {found.skipped.length}{" "}
              cannot, and {found.listed} are already on the hub.
            </Trans>
          </p>
          {found.candidates.length > 0 && (
            <ul className="max-h-72 space-y-2 overflow-auto rounded-md border p-3">
              {found.candidates.map((one) => (
                <li key={one.mapName}>
                  <CheckField
                    label={one.mapName}
                    hint={`${one.facts.filename} (${formatBytes(one.facts.size)})`}
                    checked={!unticked.has(one.mapName)}
                    onChange={(on) => tick(one.mapName, on)}
                  />
                </li>
              ))}
            </ul>
          )}
          {found.skipped.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-auto text-sm">
              {found.skipped.map((one) => (
                <li key={one.mapName}>
                  <span className="font-medium">{one.mapName}</span>{" "}
                  <span className="text-muted-foreground">{one.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {found.candidates.length > 0 && (
            <>
              <p className="text-sm">
                <Trans>
                  These files will be public. Anyone can download them from the
                  hub's mirrors.
                </Trans>
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={count === 0} onClick={upload}>
                  <Trans>
                    Upload <Plural value={count} one="# map" other="# maps" /> (
                    {size})
                  </Trans>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFound(null)}
                >
                  {t`Cancel`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {showRun && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {t`${finished} of ${run.items.length} done`}
            </span>
            {run.running && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => stopBulkUpload()}
              >
                {t`Stop`}
              </Button>
            )}
          </div>
          <ul className="max-h-72 space-y-1 overflow-auto rounded-md border p-3 text-sm">
            {run.items.map((item) => (
              <li key={item.mapName}>
                <span className="font-medium">{item.mapName}</span>{" "}
                <span
                  className={
                    item.status === "failed"
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  {statusWords[item.status]}
                  {item.said ? `: ${item.said}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
