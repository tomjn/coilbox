import { Trans, useLingui } from "@lingui/react/macro";
import { Button, useSetting } from "@picoframe/frame";
import { Download, FolderPlus, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { errorText } from "@/lib/helpers";
import {
  useDefaultWriteRoot,
  useWriteRootPath,
} from "../../../downloads/config";
import { useDownloadQueue } from "../../../downloads/DownloadQueueProvider";
import { fetchNewestRecoil } from "../../../downloads/engineInstall";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { useBundledEngine } from "../../BundledEngineSetup";
import { contentCreateStandardRoot, contentRecreateRoot } from "../../bindings";
import { useSetupStatus } from "../../config";
import {
  GetStartedOfferContext,
  useCollectGetStartedOffer,
} from "../../getStartedOffer";
import { GetStartedCard } from "./GetStartedCard";

export function SetupCard({ dismissible = false }: { dismissible?: boolean }) {
  const { t } = useLingui();
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
  const bundled = useBundledEngine();
  // The engine that came in the package is being set up, or is about to be, so
  // there is nothing to download. A failed or cancelled copy falls back to the
  // download offer below it.
  const bundleCovers =
    bundled.state.status === "checking" ||
    bundled.state.status === "copying" ||
    bundled.state.status === "done";
  const [newest, setNewest] = useState<{
    version: string;
    available: boolean;
    platform: string;
  } | null>(null);

  useEffect(() => {
    if (!needsEngine || bundleCovers) return;
    fetchNewestRecoil()
      .then(({ release, platform }) =>
        setNewest({
          version: release?.version ?? "",
          available: !!release,
          platform,
        }),
      )
      .catch(() => setNewest({ version: "", available: false, platform: "" }));
  }, [needsEngine, bundleCovers]);

  if (complete) return null;
  if (dismissible && dismissed) return null;

  const newestVersion = newest?.version ?? "";
  const newestPlatform = newest?.platform ?? "";

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
      setError(errorText(e));
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
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function downloadEngine() {
    if (!writePath) {
      setError(t`No download destination set.`);
      return;
    }
    setBusy("engine");
    setError(null);
    try {
      const { release } = await fetchNewestRecoil();
      if (!release) {
        setError(t`No engine is available to download for this platform.`);
        return;
      }
      // The queue's engineRecoil kind rescans content after the install, which
      // is what installRecoil used to do here.
      const settled = await engineDl.start({
        kind: "engineRecoil",
        label: t`Engine ${release.version}`,
        args: {
          version: release.version,
          assetUrl: release.assetUrl,
          writePath,
        },
      });
      if (settled?.error) setError(settled.error);
      else if (settled?.status === "done") await refresh();
    } catch (e) {
      setError(errorText(e));
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
        <h2 className="text-sm font-semibold">
          <Trans>Set up Coilbox</Trans>
        </h2>
        <p className="text-xs text-muted-foreground">
          <Trans>
            To play, Coilbox needs a content folder and a game engine.
          </Trans>
        </p>
      </div>

      {needsFolder &&
        (missingRoot ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              <Trans>
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
              </Trans>
            </p>
            <Button onClick={recreateFolder} disabled={busy !== null}>
              {busy === "recreate" ? (
                <Loader2 className="motion-safe:animate-spin" />
              ) : (
                <FolderPlus />
              )}
              <Trans>Recreate folder</Trans>
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
              ? t`Create folder at ${standardPath}`
              : t`Create content folder`}
          </Button>
        ))}

      {needsEngine && <BundledEngineRow />}

      {needsEngine &&
        !bundleCovers &&
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
                ? t`Waiting for a slot…`
                : busy === "engine"
                  ? t`Installing…`
                  : newestVersion
                    ? t`Download newest engine (${newestVersion})`
                    : t`Download newest engine`}
            </Button>
            <QueueProgress item={engineDl} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {newestPlatform ? (
              <Trans>
                An engine is required to play. No automatic download is
                available for your platform ({newestPlatform}) — install one
                from the{" "}
                <Link className="underline" to="/settings/engines">
                  Engines page
                </Link>
                .
              </Trans>
            ) : (
              <Trans>
                An engine is required to play. No automatic download is
                available for your platform — install one from the{" "}
                <Link className="underline" to="/settings/engines">
                  Engines page
                </Link>
                .
              </Trans>
            )}
          </p>
        ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {dismissible && (
        <button
          type="button"
          className="-mx-1 px-1 py-1.5 text-xs text-muted-foreground underline"
          onClick={() => setDismissed(true)}
        >
          <Trans>Dismiss</Trans>
        </button>
      )}
    </Card>
  );
}

/**
 * The engine row while a distribution's bundled engine is set up (issue #3668).
 * Short on purpose: the copy took about two seconds when measured, so it is a
 * line and a bar rather than a screen. Nothing while the bundle is still being
 * read or when there is none, so a plain coilbox sees the card it always did.
 */
function BundledEngineRow() {
  const { t } = useLingui();
  const { state, retry } = useBundledEngine();
  const { items } = useDownloadQueue();
  const engineVersion =
    state.status === "checking" || state.status === "none"
      ? ""
      : state.engine.version;
  const failureReason = state.status === "failed" ? state.error : "";
  switch (state.status) {
    case "checking":
    case "none":
      return null;
    case "copying": {
      const item = items.find((i) => i.id === state.id);
      return (
        <div className="space-y-2" role="status">
          <p className="flex items-center gap-2 text-xs">
            <Loader2 className="size-3.5 motion-safe:animate-spin" />
            <Trans>Setting up engine {engineVersion}</Trans>
          </p>
          <QueueProgress item={item} />
        </div>
      );
    }
    case "done":
      return (
        <p className="flex items-center gap-2 text-xs" role="status">
          <Loader2 className="size-3.5 motion-safe:animate-spin" />
          <Trans>Engine {engineVersion} is set up. Finding your games…</Trans>
        </p>
      );
    case "failed":
    case "cancelled":
      return (
        <div className="space-y-2">
          <p
            className={
              state.status === "failed"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {state.status === "failed"
              ? t`Could not set up engine ${engineVersion} from this package. ${failureReason}`
              : t`Setting up engine ${engineVersion} was cancelled.`}{" "}
            <Trans>Try again, or download an engine instead.</Trans>
          </p>
          <Button variant="outline" onClick={retry}>
            <RotateCcw />
            <Trans>Try again</Trans>
          </Button>
        </div>
      );
  }
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
