import { Button } from "@picoframe/frame";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { notify } from "../notify/notify";
import { describeOpen, prepareImport } from "./actions";
import { setDeepLinkHandler } from "./bus";
import { openScreenRoute, parseDeepLink } from "./parse";

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
 */

/** A confirmed action, held while the dialog is open. */
interface Pending {
  title: string;
  /** One line per fact the user is agreeing to. */
  lines: string[];
  warnings: string[];
  confirmLabel: string;
  run: () => void;
}

export function DeepLinkHandler({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<Pending | null>(null);

  // Build a pending confirmation from a raw link, or surface a rejection as a
  // toast. Never acts directly: the dialog's Confirm button does.
  const handleUrl = useCallback(
    (raw: string) => {
      const result = parseDeepLink(raw);
      if (result.kind === "invalid") {
        notify({
          title: "Ignored a coilbox link",
          body: result.reason,
          level: "error",
        });
        return;
      }

      if (result.kind === "open") {
        setPending({
          title: "Open a screen",
          lines: [describeOpen(result)],
          warnings: [],
          confirmLabel: "Open",
          run: () => navigate(openScreenRoute(result)),
        });
        return;
      }

      if (result.kind === "join") {
        setPending({
          title: "Join a battle",
          lines: [
            `Join battle "${result.battle}" on ${result.server}?`,
            "You will connect and join only after you confirm.",
          ],
          warnings: [],
          confirmLabel: "Join battle",
          run: () =>
            navigate("/battles", {
              state: {
                deeplinkJoin: {
                  server: result.server,
                  battle: result.battle,
                  ...(result.password ? { password: result.password } : {}),
                },
              },
            }),
        });
        return;
      }

      // Import. Fetch-URL payloads are not supported yet (see report / follow-up).
      if (result.source.type === "url") {
        notify({
          title: "Ignored a coilbox link",
          body: "Importing from a URL is not supported yet. Ask for the code instead.",
          level: "error",
        });
        return;
      }

      const plan = prepareImport(result.source.code);
      if (!plan.ok) {
        notify({
          title: "Ignored a coilbox link",
          body: plan.reason,
          level: "error",
        });
        return;
      }

      setPending({
        title: "Import from a link",
        lines: [
          `Import a ${plan.plan.label} shared with you?`,
          "It opens in the importer, which resolves any missing content before saving.",
        ],
        warnings: plan.plan.warnings,
        confirmLabel: "Continue",
        run: () => navigate(plan.plan.route),
      });
    },
    [navigate],
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // Cold start: the link the app was launched with, if any.
    getCurrent()
      .then((urls) => {
        if (!cancelled && urls && urls.length > 0) handleUrl(urls[0]);
      })
      .catch(() => {});

    // While running: links delivered by the OS (macOS) or forwarded here.
    onOpenUrl((urls) => {
      if (urls.length > 0) handleUrl(urls[0]);
    })
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
  }, [handleUrl]);

  const confirm = () => {
    const p = pending;
    setPending(null);
    p?.run();
  };

  return (
    <>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        {pending && (
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ExternalLink className="size-4 text-muted-foreground" />
                {pending.title}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Confirm this coilbox link before it runs.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 text-sm">
              {pending.lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
              {pending.warnings.map((w) => (
                <p
                  key={w}
                  className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-muted-foreground"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  {w}
                </p>
              ))}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPending(null)}>
                Cancel
              </Button>
              <Button onClick={confirm}>{pending.confirmLabel}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
