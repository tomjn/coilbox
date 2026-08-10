import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dlFetchText } from "../downloads/bindings";
import { isHubOrigin, useTrustedHubUrl } from "../hub/config";
import { hubItemIdForContainer, withHubItem } from "../hub/importRecord";
import { notify } from "../notify/notify";
import { describeOpen, type ImportPlan, prepareImport } from "./actions";
import { setDeepLinkHandler } from "./bus";
import { ConfirmDialog, type Pending } from "./ConfirmDialog";
import { type FetchText, fetchImportPlan } from "./fetchImport";
import { openScreenRoute, parseDeepLink } from "./parse";

/**
 * The production text fetcher: wraps the `dl_fetch_text` Rust command (which
 * enforces https, a byte cap and a timeout) and maps its thrown error into the
 * `FetchText` result shape `fetchImportPlan` expects. The fetch runs Rust-side
 * to bypass the webview's CORS limits (see `fetchImport.ts`).
 */
const fetchImportText: FetchText = async (url) => {
  try {
    const { text } = await dlFetchText({ url });
    return { ok: true, text };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
};

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
 */

export function DeepLinkHandler({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const trustedHubUrl = useTrustedHubUrl();
  const [pending, setPending] = useState<Pending | null>(null);
  // Set while a fetch-URL import is downloading, so the user sees progress and
  // cannot fire a second fetch. Holds the host being contacted.
  const [fetching, setFetching] = useState<string | null>(null);

  // Build the second (apply) confirmation for a resolved import plan. `host` is
  // set for a fetch-URL import so the dialog says where the content came from.
  const buildImportPending = useCallback(
    (plan: ImportPlan, host?: string, hubItemId?: string): Pending => ({
      title: "Import from a link",
      lines: [
        host
          ? `Import a ${plan.label} downloaded from ${host}?`
          : `Import a ${plan.label} shared with you?`,
        plan.detail ??
          "It opens in the importer, which resolves any missing content before saving.",
      ],
      warnings: plan.warnings,
      confirmLabel: "Continue",
      run: () => navigate(withHubItem(plan.route, hubItemId)),
    }),
    [navigate],
  );

  // Contact the host, cap and validate the response, then offer to apply it.
  // Only ever called after the user agreed to the fetch. Applies nothing here.
  const runFetch = useCallback(
    async (url: string, host: string) => {
      setFetching(host);
      const result = await fetchImportPlan(url, fetchImportText);
      setFetching(null);
      if (!result.ok) {
        notify({
          title: "Ignored a coilbox link",
          body: result.reason,
          level: "error",
        });
        return;
      }
      // Only the browse screen knows which hub item an address belongs to, and
      // only for one it read off the hub itself this session (issue #1368). An
      // address from anywhere else is not claimed, so it records nothing.
      setPending(
        buildImportPending(
          result.plan,
          result.host,
          hubItemIdForContainer(url),
        ),
      );
    },
    [buildImportPending],
  );

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

      // Import from a URL: confirm the network fetch first, then fetch, validate
      // and confirm again. No request is made before the user agrees.
      if (result.source.type === "url") {
        const { url } = result.source;
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
          title: "Download an import",
          lines: [
            `This link downloads an import from ${host}.`,
            "Coilbox has not contacted it yet. Only continue if you trust this link.",
          ],
          warnings: [],
          confirmLabel: "Fetch and check",
          run: () => void runFetch(url, host),
        });
        return;
      }

      // Import from an inline code: validate and confirm in one step.
      const plan = prepareImport(result.source.code);
      if (!plan.ok) {
        notify({
          title: "Ignored a coilbox link",
          body: plan.reason,
          level: "error",
        });
        return;
      }

      setPending(buildImportPending(plan.plan));
    },
    [navigate, runFetch, buildImportPending, trustedHubUrl],
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

  return (
    <>
      {children}
      <Dialog open={fetching !== null}>
        <DialogContent className="sm:max-w-md" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
              Downloading an import
            </DialogTitle>
            <DialogDescription>
              Contacting {fetching} and checking what it sends back.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
      <ConfirmDialog pending={pending} setPending={setPending} />
    </>
  );
}
