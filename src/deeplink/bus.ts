import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * A one-slot dispatch bus for `coilbox://` links (issue #388). The mounted
 * `DeepLinkHandler` registers itself here so an in-app click (a link in chat)
 * routes straight to the confirm-before-act handler, instead of round-tripping
 * through the OS. When no handler is mounted, it falls back to the OS, which
 * dispatches the link back through the registered scheme.
 */

type DeepLinkHandlerFn = (url: string) => void;

let current: DeepLinkHandlerFn | null = null;

/** Register (or clear, with null) the in-app deep-link handler. */
export function setDeepLinkHandler(handler: DeepLinkHandlerFn | null): void {
  current = handler;
}

/** Route a `coilbox://` link to the in-app handler, or to the OS as a fallback. */
export function dispatchDeepLink(url: string): void {
  if (current) current(url);
  else openUrl(url).catch(() => {});
}
