import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { FileArchive, Loader2 } from "lucide-react";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { compatExport, compatStatus } from "../../compat/bindings";
import { pickSdzPath } from "../../compat/pickSdzPath";
import { primeGameInfo } from "../../content/config";

/**
 * Offers a host the `.sdz` of the mutator their battle runs (issue #4712). Players
 * with coilbox build it themselves on join, and nobody else can get it any other
 * way. The export and a built folder have the same checksum (issue #4713).
 */
export function CompatHostExport({
  enginePath,
  dataDir,
  baseArchive,
}: {
  enginePath: string;
  dataDir: string;
  baseArchive: string;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);
  const [exportedTo, setExportedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportSdz = async () => {
    setError(null);
    setBusy(true);
    try {
      const info = await primeGameInfo(enginePath, dataDir, baseArchive);
      if (!info.checksum) {
        setError(t`The game could not be read`);
        return;
      }
      const status = await compatStatus({
        dataDir,
        enginePath,
        archiveName: baseArchive,
        baseChecksum: info.checksum,
      });
      if (!status.folder) {
        setError(t`Not built`);
        return;
      }
      const dest = await pickSdzPath(status.folder);
      if (!dest) return;
      const done = await compatExport({
        dataDir,
        enginePath,
        archiveName: baseArchive,
        baseChecksum: info.checksum,
        dest,
      });
      setExportedTo(done.path);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">
          <Trans>Players without coilbox need the .sdz</Trans>
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 gap-1.5"
          disabled={busy}
          onClick={() => void exportSdz()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileArchive className="size-4" />
          )}
          <Trans>Export .sdz</Trans>
        </Button>
      </div>
      {exportedTo && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Exported to <span className="font-mono">{exportedTo}</span>
          </Trans>
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
