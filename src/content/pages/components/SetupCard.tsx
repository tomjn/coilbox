import { Button, useSetting } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { Download, FolderPlus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import type { DownloadProgress } from "../../../downloads/bindings";
import { useWriteRootPath } from "../../../downloads/config";
import {
  fetchNewestRecoil,
  installRecoil,
} from "../../../downloads/engineInstall";
import { ProgressBar } from "../../../downloads/pages/components/ProgressBar";
import { errMessage } from "../../../downloads/pages/components/states";
import { contentCreateStandardRoot } from "../../bindings";
import { useSetupStatus } from "../../config";

export function SetupCard({ dismissible = false }: { dismissible?: boolean }) {
  const { needsFolder, needsEngine, complete, standardPath, refresh } =
    useSetupStatus();
  const writePath = useWriteRootPath();
  const [dismissed, setDismissed] = useSetting<boolean>(
    "setup.dismissed",
    false,
  );
  const [busy, setBusy] = useState<null | "folder" | "engine">(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [newest, setNewest] = useState<{
    version: string;
    available: boolean;
    platform: string;
  } | null>(null);

  useEffect(() => {
    if (!needsEngine) return;
    fetchNewestRecoil()
      .then(({ release, platform }) =>
        setNewest({
          version: release?.version ?? "",
          available: !!release,
          platform,
        }),
      )
      .catch(() => setNewest({ version: "", available: false, platform: "" }));
  }, [needsEngine]);

  if (complete) return null;
  if (dismissible && dismissed) return null;

  async function createFolder() {
    setBusy("folder");
    setError(null);
    try {
      await contentCreateStandardRoot(undefined);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadEngine() {
    if (!writePath) {
      setError("No download destination set.");
      return;
    }
    setBusy("engine");
    setError(null);
    setProgress(null);
    const onProgress = new Channel<DownloadProgress>();
    onProgress.onmessage = (p) => setProgress(p);
    try {
      const { release } = await fetchNewestRecoil();
      if (!release) return;
      await installRecoil(release, writePath, onProgress);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Set up Coilbox</h2>
        <p className="text-xs text-muted-foreground">
          To play, Coilbox needs a content folder and a game engine.
        </p>
      </div>

      {needsFolder && (
        <Button onClick={createFolder} disabled={busy !== null}>
          {busy === "folder" ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FolderPlus />
          )}
          {standardPath
            ? `Create folder at ${standardPath}`
            : "Create content folder"}
        </Button>
      )}

      {needsEngine &&
        (newest?.available ? (
          <div className="space-y-2">
            <Button
              onClick={downloadEngine}
              disabled={busy !== null || !writePath}
            >
              {busy === "engine" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Download />
              )}
              {busy === "engine"
                ? "Installing…"
                : `Download newest engine${newest.version ? ` (${newest.version})` : ""}`}
            </Button>
            {busy === "engine" && progress && (
              <ProgressBar progress={progress} />
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            An engine is required to play. No automatic download is available
            for your platform{newest?.platform ? ` (${newest.platform})` : ""} —
            install one from the{" "}
            <Link className="underline" to="/settings/engines">
              Engines page
            </Link>
            .
          </p>
        ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {dismissible && (
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      )}
    </section>
  );
}
