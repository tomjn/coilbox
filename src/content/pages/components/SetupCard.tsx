import { Button, useSetting } from "@picoframe/frame";
import { Download, FolderPlus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import {
  useDefaultWriteRoot,
  useWriteRootPath,
} from "../../../downloads/config";
import { fetchNewestRecoil } from "../../../downloads/engineInstall";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { errMessage } from "../../../downloads/pages/components/states";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { contentCreateStandardRoot, contentRecreateRoot } from "../../bindings";
import { useSetupStatus } from "../../config";
import {
  GetStartedOfferContext,
  useCollectGetStartedOffer,
} from "../../getStartedOffer";
import { GetStartedCard } from "./GetStartedCard";

export function SetupCard({ dismissible = false }: { dismissible?: boolean }) {
  const {
    needsFolder,
    needsEngine,
    complete,
    standardPath,
    missingRoot,
    refresh,
  } = useSetupStatus();
  const writePath = useWriteRootPath();
  const ensureWriteRoot = useDefaultWriteRoot();
  const [dismissed, setDismissed] = useSetting<boolean>(
    "setup.dismissed",
    false,
  );
  const [busy, setBusy] = useState<null | "folder" | "recreate" | "engine">(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const engineDl = useQueuedDownload();
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
      const { state } = await contentCreateStandardRoot(undefined);
      // Default the download destination to the new folder so the engine step
      // isn't a disabled button this same session.
      ensureWriteRoot(state);
      await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function recreateFolder() {
    if (!missingRoot) return;
    setBusy("recreate");
    setError(null);
    try {
      const { state } = await contentRecreateRoot({ path: missingRoot.path });
      ensureWriteRoot(state);
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
    try {
      const { release } = await fetchNewestRecoil();
      if (!release) {
        setError("No engine is available to download for this platform.");
        return;
      }
      // The queue's engineRecoil kind rescans content after the install, which
      // is what installRecoil used to do here.
      const settled = await engineDl.start({
        kind: "engineRecoil",
        label: `Engine ${release.version}`,
        args: {
          version: release.version,
          assetUrl: release.assetUrl,
          writePath,
        },
      });
      if (settled?.error) setError(settled.error);
      else if (settled?.status === "done") await refresh();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // The three spinners below are `motion-safe:`, so a reader who asked the OS for
  // less motion gets a still glyph and the button's disabled state as the cue that
  // something is running. This card is a welcome zone (`home/zones/Onboarding`),
  // and the suggested map's spinner one card away already made that call, so an
  // unguarded one here was the same page answering the same question twice.
  return (
    <Card className="gap-3 rounded-lg border-border p-4 shadow-none">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Set up Coilbox</h2>
        <p className="text-xs text-muted-foreground">
          To play, Coilbox needs a content folder and a game engine.
        </p>
      </div>

      {needsFolder &&
        (missingRoot ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Your content folder{" "}
              <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">
                {missingRoot.path}
              </code>{" "}
              is missing. Recreate it to continue, or add a different folder
              from the{" "}
              <Link className="underline" to="/settings/content-folders">
                Content folders
              </Link>{" "}
              page.
            </p>
            <Button onClick={recreateFolder} disabled={busy !== null}>
              {busy === "recreate" ? (
                <Loader2 className="motion-safe:animate-spin" />
              ) : (
                <FolderPlus />
              )}
              Recreate folder
            </Button>
          </div>
        ) : (
          <Button onClick={createFolder} disabled={busy !== null}>
            {busy === "folder" ? (
              <Loader2 className="motion-safe:animate-spin" />
            ) : (
              <FolderPlus />
            )}
            {standardPath
              ? `Create folder at ${standardPath}`
              : "Create content folder"}
          </Button>
        ))}

      {needsEngine &&
        (newest?.available ? (
          <div className="space-y-2">
            <Button
              onClick={downloadEngine}
              disabled={busy !== null || !writePath}
            >
              {busy === "engine" ? (
                <Loader2 className="motion-safe:animate-spin" />
              ) : (
                <Download />
              )}
              {engineDl.status === "queued"
                ? "Waiting for a slot…"
                : busy === "engine"
                  ? "Installing…"
                  : `Download newest engine${newest.version ? ` (${newest.version})` : ""}`}
            </Button>
            <QueueProgress item={engineDl} />
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
          className="-mx-1 px-1 py-1.5 text-xs text-muted-foreground underline"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      )}
    </Card>
  );
}

/**
 * The `@widget/onboarding` body: the dismissible setup card, followed by the
 * get-started suggestions once setup is complete. Both render `null` when not
 * needed, so a healthy install with content shows nothing.
 *
 * A distribution embedding this widget in its own markup has asked for the cards
 * at that spot, so unlike the home page's Onboarding zone it does not consult
 * the `onboarding` placement.
 *
 * It collects the offer itself, because a custom page is not the home route and
 * so has nothing above it holding one (issue #1111). One collection per page
 * either way, and the card never resolves its own: {@link useGetStartedOffer}
 * throws where there is no collection to read.
 */
export function HomeSetupCard() {
  const offer = useCollectGetStartedOffer();
  return (
    <GetStartedOfferContext value={offer}>
      <div className="mb-2 flex flex-col gap-4">
        <SetupCard dismissible />
        <GetStartedCard />
      </div>
    </GetStartedOfferContext>
  );
}
