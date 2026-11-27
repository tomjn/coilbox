import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Clapperboard, Loader2, PackagePlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fileDropClaimed } from "@/lib/fileDropClaim";
import { containerKindPhrase } from "../container/names";
import {
  contentAddReplayFile,
  contentInspectReplayFile,
} from "../content/bindings";
import { invalidateScans, useScanTargetSelection } from "../content/config";
import { loadReplays } from "../content/replayList";
import { dlInspectArchive, dlInstallArchive } from "../downloads/bindings";
import { useArchiveInstallSettings, useWriteRoot } from "../downloads/config";
import {
  type ArchiveOffer,
  type ArchiveRoots,
  describeOffers,
  installArchives,
  isArchivePath,
  pathFromFileUrl,
  planArchives,
} from "../downloads/installArchive";
import {
  hubItemIdFromUrl,
  hubItemRoute,
  isHubItemPageReachable,
  isHubOrigin,
  useTrustedHubUrl,
} from "../hub/config";
import { withHubItem } from "../hub/importRecord";
import { inviteLinkFrom } from "../multiplayer/invite/inviteOffer";
import {
  invitePromptOpen,
  offerInvite,
} from "../multiplayer/invite/inviteStore";
import { notify } from "../notify/notify";
import { type ArchiveChoice, ArchiveChoices } from "./ArchiveChoices";
import { describeOpen, type ImportPlan, prepareImport } from "./actions";
import { setDeepLinkHandler } from "./bus";
import { ConfirmDialog, type Pending } from "./ConfirmDialog";
import { fetchImportPlan } from "./fetchImport";
import { fetchImportText } from "./fetchText";
import { openScreenRoute, parseDeepLink } from "./parse";
import {
  addReplays,
  describeReplayOffers,
  heldLine,
  isReplayPath,
  planReplays,
  type ReplayOffer,
  replayRoute,
} from "./replayFiles";

/**
 * The `coilbox://` deep-link handler (issue #388). Mounted app-wide as the
 * plugin's Provider (see `index.ts`), so it lives inside the router and can
 * navigate. It listens for links arriving while the app runs and reads the link
 * the app was cold-started with, then confirms every one before acting: no
 * silent joins and no silent imports.
 *
 * A link is untrusted (it comes from Discord or lobby chat), so it is parsed and
 * validated first (`parse.ts`), and an import payload is additionally gated
 * through `identify()` (`actions.ts`) before the confirm dialog offers to act.
 * Acting on an import navigates to the matching importer page carrying the code,
 * so the importer's own decode plus `ResolveContentGate` flow (issue #387) runs
 * unchanged, resolving any missing content before anything is saved.
 *
 * A fetch-URL import (`import?url=`, issue #482) pulls content from a remote
 * host, so it is higher risk and uses two confirmations, never one. First the
 * user agrees to contact the host (no network request happens before this).
 * Then coilbox fetches the URL with a byte cap and a timeout, runs the result
 * through `identify()` (via `fetchImportPlan`), and only on a recognised
 * container asks a second time to apply what was found. A rejected or oversized
 * response applies nothing.
 *
 * One host is not a stranger: the Coilbox hub this install is configured against
 * (issue #1367). The player either accepted the built-in default or typed the
 * address in themselves, and the browse screen is already talking to it. So a URL
 * on that origin skips the first confirmation, the one about contacting a host,
 * and keeps the second, the one showing what came back. Contacting a host coilbox
 * already contacts tells the user nothing; what a stranger uploaded to it is still
 * a decision, and it is still theirs. The match is by origin against
 * `useTrustedHubUrl()`, which is null when a profile switched the hub off, and it
 * changes only how much is explained: every check the import already ran still
 * runs.
 *
 * One address on that hub is not a fetch at all: an item's share page,
 * `<hub>/i/<id>`, which is what the website's Import button links to. That opens
 * the item's own page (issue #1366), which describes the thing in full and asks
 * there. Nothing is downloaded and nothing is applied by arriving, so there is
 * no confirmation before it: the page is the confirmation. `hubItemIdFromUrl`
 * only reads an id out of that one path shape, so every other hub address, its
 * gallery, its API, its home page, still takes the fetch flow above.
 *
 * A game or map archive the player has as a file comes through here too. It
 * arrives three ways: dropped on the window, opened with coilbox on macOS, which
 * the OS delivers as a `file://` URL on the event links use, and opened with
 * coilbox on Windows or Linux, which is a launch argument (`open_file.rs`). All
 * three end at `offerArchives`, which reads the file, asks with the same dialog
 * and under the same one prompt at a time rule, and only then copies it into the
 * content folder chosen for its kind. The prompt can be turned off and the
 * original deleted after the copy, both from the prompt itself or from
 * Settings > Sources.
 */

export function DeepLinkHandler({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const trustedHubUrl = useTrustedHubUrl();
  const [pending, setPendingState] = useState<Pending | null>(null);
  // Set while a fetch-URL import is downloading, so the user sees progress and
  // cannot fire a second fetch. Holds the host being contacted.
  const [fetching, setFetchingState] = useState<string | null>(null);
  // What is open right now, kept where a link that arrives in the same moment
  // can read it. State is only current after the next render, and a second link
  // must not slip in before it.
  const open = useRef<{
    pending: boolean;
    fetching: boolean;
    archives: boolean;
    replays: boolean;
  }>({
    pending: false,
    fetching: false,
    archives: false,
    replays: false,
  });
  const setPending = useCallback((next: Pending | null) => {
    open.current.pending = next !== null;
    setPendingState(next);
  }, []);
  const setFetching = useCallback((host: string | null) => {
    open.current.fetching = host !== null;
    setFetchingState(host);
  }, []);
  // Whether archives are being read or copied, as state too, so replays from
  // the same drop wait until the archives are done.
  const [archivesOpen, setArchivesOpenState] = useState(false);
  const setArchivesOpen = useCallback((next: boolean) => {
    open.current.archives = next;
    setArchivesOpenState(next);
  }, []);

  const gamesRoot = useWriteRoot("games");
  const mapsRoot = useWriteRoot("maps");
  const archiveSettings = useArchiveInstallSettings();
  // Files handed over and not yet read. They wait here until the content
  // folders are known, which on a cold start is after the file arrives.
  const [queued, setQueued] = useState<string[] | null>(null);
  // What is being copied right now, for the notice that covers a copy. A game
  // can be most of a gigabyte, and the dialog has closed by the time it starts.
  const [installing, setInstalling] = useState<string | null>(null);
  // What is being dragged over the window: archives to install, replays to
  // add, or nothing coilbox takes.
  const [dragging, setDragging] = useState<"install" | "add" | null>(null);

  // Replay files handed over and not yet read. They wait for any archive
  // prompt from the same drop to be answered, and for the library's folder.
  const { selected } = useScanTargetSelection();
  const writeRoot = useWriteRoot();
  // The folder the replay library lists, as `useReplaysRoot` picks it.
  const replaysRoot = selected?.rootPath ?? writeRoot.path;
  const [replayQueue, setReplayQueue] = useState<string[] | null>(null);

  // Take a set of files to install or add. Nothing is read or copied here: the
  // effects below read them, and the dialogs they open do the copying. Archives
  // and replays dropped together are asked about one after the other.
  const offerArchives = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      if (
        open.current.pending ||
        open.current.fetching ||
        open.current.archives ||
        open.current.replays ||
        invitePromptOpen()
      ) {
        notify({
          title: t`Ignored a file`,
          // The refusal for a file, worded like the one for a link below.
          body: t`Another prompt is still open. Answer or close it, then open this file again.`,
          level: "error",
        });
        return;
      }
      const replays = paths.filter(isReplayPath);
      const archives = paths.filter((p) => !isReplayPath(p));
      if (archives.length > 0) {
        setArchivesOpen(true);
        setQueued(archives);
      }
      if (replays.length > 0) {
        open.current.replays = true;
        setReplayQueue(replays);
      }
    },
    [setArchivesOpen],
  );

  const runInstall = useCallback(
    async (offers: ArchiveOffer[], roots: ArchiveRoots, move: boolean) => {
      // A copy holds the one prompt, like a fetch does, so nothing else is
      // asked over the top of it.
      setArchivesOpen(true);
      setInstalling(
        offers.length === 1
          ? offers[0].fileName
          : plural(offers.length, { other: "# archives" }),
      );
      const { installed, failed, notMoved } = await installArchives(
        offers,
        roots,
        move,
        dlInstallArchive,
      );
      setArchivesOpen(false);
      setInstalling(null);
      if (installed.length > 0) {
        // The game and map lists read the disk again, so the new one shows
        // without a restart.
        invalidateScans();
        const installedCount = installed.length;
        const fileName = installed[0].fileName;
        const destDir = installed[0].destDir;
        notify(
          installedCount === 1
            ? {
                title: t`Installed ${fileName}`,
                body:
                  move && notMoved.length === 0
                    ? t`Moved to ${destDir}.`
                    : t`Copied to ${destDir}.`,
                level: "success",
              }
            : {
                title: plural(installedCount, {
                  other: "Installed # archives",
                }),
                body: installed.map((o) => o.fileName).join(", "),
                level: "success",
              },
        );
      }
      if (failed.length > 0) {
        notify({
          title: t`Could not install an archive`,
          body: failed.join(" "),
          level: "error",
        });
      }
      if (notMoved.length > 0) {
        notify({
          title: t`Could not delete an original`,
          body: notMoved.join(" "),
          level: "warning",
        });
      }
    },
    [setArchivesOpen],
  );

  useEffect(() => {
    if (!queued || gamesRoot.loading || mapsRoot.loading) return;
    const roots = { gamesRoot: gamesRoot.path, mapsRoot: mapsRoot.path };
    setQueued(null);
    void planArchives(queued, roots, dlInspectArchive).then(
      ({ offers, refused }) => {
        setArchivesOpen(false);
        if (offers.length === 0) {
          notify({
            title: t`Nothing was installed`,
            body: refused.join(" "),
            level: "error",
          });
          return;
        }
        const { move, noPrompt, setMove, setNoPrompt } = archiveSettings;
        if (noPrompt) {
          if (refused.length > 0) {
            notify({
              title: t`Some files were not installed`,
              body: refused.join(" "),
              level: "error",
            });
          }
          void runInstall(offers, roots, move);
          return;
        }
        let choice: ArchiveChoice = { move, noPrompt: false };
        setPending({
          ...describeOffers(offers),
          warnings: refused,
          confirmLabel: t`Install`,
          icon: PackagePlus,
          extra: (
            <ArchiveChoices
              initial={choice}
              onChange={(next) => {
                choice = next;
              }}
            />
          ),
          run: () => {
            // Not asking again keeps this answer for next time, including
            // whether to delete the original.
            if (choice.noPrompt) {
              setMove(choice.move);
              setNoPrompt(true);
            }
            void runInstall(offers, roots, choice.move);
          },
        });
      },
    );
  }, [
    queued,
    gamesRoot,
    mapsRoot,
    archiveSettings,
    runInstall,
    setPending,
    setArchivesOpen,
  ]);

  const runAddReplays = useCallback(
    async (offers: ReplayOffer[], root: string) => {
      const { added, failed } = await addReplays(
        offers,
        root,
        contentAddReplayFile,
      );
      if (added.length > 0) {
        // The library reads its folder again, so the new one is listed.
        loadReplays(root, true).catch(() => {});
        const route =
          added.length === 1 ? replayRoute(added[0].fileName) : "/play/replays";
        notify({
          title: plural(added.length, {
            one: "Added a replay to your library",
            other: "Added # replays to your library",
          }),
          body: added.map((o) => o.fileName).join(", "),
          level: "success",
          to: route,
          action: { label: t`Open`, onClick: () => navigate(route) },
        });
      }
      if (failed.length > 0) {
        notify({
          title: t`Could not add a replay`,
          body: failed.join(" "),
          level: "error",
        });
      }
    },
    [navigate],
  );

  useEffect(() => {
    // An archive prompt from the same drop is answered first.
    if (!replayQueue || archivesOpen || pending) return;
    if (!replaysRoot) {
      if (writeRoot.loading) return;
      setReplayQueue(null);
      open.current.replays = false;
      notify({
        title: t`Nothing was added`,
        body: t`There is no content folder to keep replays in. Choose one in Settings > Sources.`,
        level: "error",
      });
      return;
    }
    const root = replaysRoot;
    setReplayQueue(null);
    void planReplays(replayQueue, root, contentInspectReplayFile).then(
      ({ offers, held, refused }) => {
        open.current.replays = false;
        const notes = [...held.map(heldLine), ...refused];
        if (offers.length > 0) {
          setPending({
            ...describeReplayOffers(offers),
            warnings: notes,
            confirmLabel: t`Add to library`,
            icon: Clapperboard,
            run: () => void runAddReplays(offers, root),
          });
          return;
        }
        if (held.length === 1) {
          const route = replayRoute(held[0].inLibrary ?? "");
          setPending({
            title: t`Already in your library`,
            lines: [heldLine(held[0])],
            warnings: refused,
            confirmLabel: t`Open it`,
            icon: Clapperboard,
            run: () => navigate(route),
          });
          return;
        }
        notify({
          title: t`Nothing was added`,
          body: notes.join(" "),
          level: held.length > 0 && refused.length === 0 ? "info" : "error",
        });
      },
    );
  }, [
    replayQueue,
    archivesOpen,
    pending,
    replaysRoot,
    writeRoot.loading,
    runAddReplays,
    setPending,
    navigate,
  ]);

  // Build the second (apply) confirmation for a resolved import plan. `host` is
  // set for a fetch-URL import so the dialog says where the content came from.
  const buildImportPending = useCallback(
    (plan: ImportPlan, host?: string, hubItemId?: string): Pending => {
      const planPhrase = containerKindPhrase(plan.phrase);
      return {
        title: t`Import from a link`,
        lines: [
          host
            ? t`Import ${planPhrase} downloaded from ${host}?`
            : t`Import ${planPhrase} shared with you?`,
          plan.detail ??
            t`It opens in the importer, which resolves any missing content before saving.`,
        ],
        warnings: plan.warnings,
        confirmLabel: t`Continue`,
        run: () => navigate(withHubItem(plan.route, hubItemId)),
      };
    },
    [navigate],
  );

  // Contact the host, cap and validate the response, then offer to apply it.
  // Only ever called after the user agreed to the fetch. Applies nothing here.
  const runFetch = useCallback(
    async (url: string, host: string, hubItemId?: string) => {
      setFetching(host);
      const result = await fetchImportPlan(url, fetchImportText);
      setFetching(null);
      if (!result.ok) {
        notify({
          title: t`Ignored a coilbox link`,
          body: result.reason,
          level: "error",
        });
        return;
      }
      // The id is only known for an item address on the configured hub, which
      // the caller works out. Any other address records nothing.
      setPending(buildImportPending(result.plan, result.host, hubItemId));
    },
    [buildImportPending, setFetching, setPending],
  );

  // Build a pending confirmation from a raw link, or surface a rejection as a
  // toast. Never acts directly: the dialog's Confirm button does.
  const handleUrl = useCallback(
    (raw: string) => {
      // A file opened with coilbox, which macOS delivers as a URL.
      const file = pathFromFileUrl(raw);
      if (file !== null) {
        offerArchives([file]);
        return;
      }

      const result = parseDeepLink(raw);
      if (result.kind === "invalid") {
        notify({
          title: t`Ignored a coilbox link`,
          body: result.reason,
          level: "error",
        });
        return;
      }

      // One prompt at a time, across every kind (issue #3409). The button a
      // player has read keeps doing what the words above it said, so a link that
      // arrives while another is being asked about, or while an import is being
      // fetched for the player to answer next, is refused rather than swapped in.
      if (
        open.current.pending ||
        open.current.fetching ||
        open.current.archives ||
        open.current.replays ||
        invitePromptOpen()
      ) {
        notify({
          title: t`Ignored a coilbox link`,
          // Written the way the invite store's refusal of a second join link is.
          body: t`Another link is still open. Answer or close it, then open this link again.`,
          level: "error",
        });
        return;
      }

      if (result.kind === "open") {
        setPending({
          title: t`Open a screen`,
          lines: [describeOpen(result)],
          warnings: [],
          confirmLabel: t`Open`,
          run: () => navigate(openScreenRoute(result)),
        });
        return;
      }

      // A battle on a lobby server (issue #3382). What to offer depends on
      // which servers and logins this player has, so the question is asked by
      // `InviteLinkHost`, which can see them. Handing the link over connects
      // nothing. A link that arrives while one is still being asked about is
      // refused, so the button somebody has read keeps meaning what it said.
      if (result.kind === "join") {
        const link = inviteLinkFrom(result);
        if (!link) {
          notify({
            title: t`Ignored a coilbox link`,
            body: t`This join link is not one coilbox can read.`,
            level: "error",
          });
        } else if (!offerInvite(link)) {
          notify({
            title: t`Ignored a coilbox link`,
            body: t`Another invite is still open. Answer or close it, then open this link again.`,
            level: "error",
          });
        }
        return;
      }

      // A room somebody is hosting themselves (issue #1612). Nothing here can
      // tell whether it is still up: a room is a port on a machine and the only
      // way to ask is to dial it, which is the thing this must not do before the
      // person agrees. So this confirms, then opens the join form filled in, and
      // the room being gone is answered where the join is made, in the words
      // `joinRoomFailure` already had for it.
      if (result.kind === "room") {
        const roomAddress = result.address;
        const roomPort = result.port;
        setPending({
          title: t`Join a room`,
          lines: [
            t`Join the room at ${roomAddress}:${roomPort}?`,
            t`The join form opens filled in. Nothing connects until you press Join in it.`,
          ],
          warnings: [],
          confirmLabel: t`Open the join form`,
          run: () =>
            navigate("/battles", {
              state: {
                deeplinkRoom: { address: result.address, port: result.port },
              },
            }),
        });
        return;
      }

      // Import from a URL: confirm the network fetch first, then fetch, validate
      // and confirm again. No request is made before the user agrees.
      if (result.source.type === "url") {
        const { url } = result.source;
        // An item's share page on the configured hub: open the page coilbox has
        // for it, which says what it is and offers to import it there. When that
        // page is switched off the route would send the player home, so the
        // item's container is fetched from the configured hub instead. That is
        // not the pasted address, which can be the item's web page or the hub's
        // old address.
        const hubItemId = hubItemIdFromUrl(url, trustedHubUrl);
        if (hubItemId && trustedHubUrl) {
          if (isHubItemPageReachable()) {
            navigate(hubItemRoute(hubItemId));
            return;
          }
          const base = trustedHubUrl.replace(/\/+$/, "");
          const container = `${base}/i/${encodeURIComponent(hubItemId)}`;
          void runFetch(container, new URL(container).host, hubItemId);
          return;
        }
        let host: string;
        try {
          host = new URL(url).host;
        } catch {
          host = url;
        }
        // The configured hub is a host coilbox is already talking to, so asking
        // permission to contact it is ceremony. Fetch straight away and let the
        // apply confirmation, which is untouched, carry the decision.
        if (isHubOrigin(url, trustedHubUrl)) {
          void runFetch(url, host);
          return;
        }
        setPending({
          title: t`Download an import`,
          lines: [
            t`This link downloads an import from ${host}.`,
            t`Coilbox has not contacted it yet. Only continue if you trust this link.`,
          ],
          warnings: [],
          confirmLabel: t`Fetch and check`,
          run: () => void runFetch(url, host),
        });
        return;
      }

      // Import from an inline code: validate and confirm in one step.
      const plan = prepareImport(result.source.code);
      if (!plan.ok) {
        notify({
          title: t`Ignored a coilbox link`,
          body: plan.reason,
          level: "error",
        });
        return;
      }

      setPending(buildImportPending(plan.plan));
    },
    [
      navigate,
      runFetch,
      buildImportPending,
      setPending,
      trustedHubUrl,
      offerArchives,
    ],
  );

  // What the OS hands over at once. Several files opened together arrive as
  // one list and are asked about together. A link is still taken one at a time.
  const receive = useCallback(
    (urls: string[]) => {
      const files = urls
        .map(pathFromFileUrl)
        .filter((path): path is string => path !== null);
      if (files.length > 0) offerArchives(files);
      else if (urls.length > 0) handleUrl(urls[0]);
    },
    [handleUrl, offerArchives],
  );

  // Files that do not come as a URL: one dropped on the window, and one opened
  // with coilbox on Windows or Linux.
  useEffect(() => {
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    const keep = (subscription: Promise<() => void>) =>
      subscription
        .then((fn) => {
          if (cancelled) fn();
          else unlisten.push(fn);
        })
        .catch(() => {});

    // Cold start. The command answers once, so the files it names are taken
    // even if this effect has been torn down and run again by then.
    invoke<string[]>("launch_archives")
      .then(offerArchives)
      .catch(() => {});

    keep(listen<string[]>("open-archive", (e) => offerArchives(e.payload)));

    try {
      keep(
        getCurrentWebview().onDragDropEvent((event) => {
          const p = event.payload;
          // A page that takes dropped files for itself is on screen.
          if (fileDropClaimed()) {
            setDragging(null);
            return;
          }
          if (p.type === "enter") {
            setDragging(
              p.paths.some(isArchivePath)
                ? "install"
                : p.paths.some(isReplayPath)
                  ? "add"
                  : null,
            );
          } else if (p.type === "leave") setDragging(null);
          else if (p.type === "drop") {
            setDragging(null);
            offerArchives(p.paths);
          }
        }),
      );
    } catch {
      // No webview to listen on, which is a test or a plain browser.
    }

    return () => {
      cancelled = true;
      for (const fn of unlisten) fn();
    };
  }, [offerArchives]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // Cold start: the link the app was launched with, if any.
    getCurrent()
      .then((urls) => {
        if (!cancelled && urls) receive(urls);
      })
      .catch(() => {});

    // While running: links delivered by the OS (macOS) or forwarded here.
    onOpenUrl(receive)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    // Route in-app clicks (a coilbox link in chat) straight here, no OS trip.
    setDeepLinkHandler(handleUrl);

    // Dev-only: OS URL dispatch does not work in a non-bundled `tauri dev`
    // build, so expose a hook to feed a crafted link through the same path for
    // live testing. Dropped from release builds (import.meta.env.DEV is false).
    if (import.meta.env.DEV) {
      (
        window as unknown as { __coilboxDeepLink?: (u: string) => void }
      ).__coilboxDeepLink = handleUrl;
    }

    return () => {
      cancelled = true;
      unlisten?.();
      setDeepLinkHandler(null);
    };
  }, [handleUrl, receive]);

  return (
    <>
      {children}
      <Dialog open={fetching !== null}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <Trans>Downloading an import</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Contacting {fetching} and checking what it sends back.
              </Trans>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <Dialog open={installing !== null}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              <Trans>Installing</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>Copying {installing}.</Trans>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <ConfirmDialog pending={pending} setPending={setPending} />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <p className="flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm font-medium">
            {dragging === "install" ? (
              <>
                <PackagePlus className="size-4 text-muted-foreground" />
                <Trans>Drop to install</Trans>
              </>
            ) : (
              <>
                <Clapperboard className="size-4 text-muted-foreground" />
                <Trans>Drop to add to your replays</Trans>
              </>
            )}
          </p>
        </div>
      )}
    </>
  );
}
