import { notify } from "../notify/notify";

/** Cancellations are intentional — never surface them as a failure. */
function isCancellation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /cancel/i.test(msg);
}

/** Compute the label without ever throwing — a bad label must not misroute the
 * download's success/failure or replace its error. */
function safeLabel<A>(label: (args: A) => string, args: A): string {
  try {
    return label(args);
  } catch {
    return "";
  }
}

/**
 * Wrap a download-start binding so it fires a notification when the download
 * settles: a success toast/banner on resolve, a failure one on reject (except
 * cancellations, which are user-intended). `label` derives a human-readable name
 * from the call's args (tag / springName / filename / version). The original
 * result is returned and the original error re-thrown, so callers' progress UIs
 * and catch blocks are unaffected — the notification is a pure side effect.
 */
export function withDownloadNotify<A, D>(
  fn: (args: A) => Promise<D>,
  label: (args: A) => string,
): (args: A) => Promise<D> {
  return async (args: A) => {
    try {
      const result = await fn(args);
      void notify({
        title: "Download complete",
        body: safeLabel(label, args),
        level: "success",
      });
      return result;
    } catch (e) {
      if (!isCancellation(e)) {
        void notify({
          title: "Download failed",
          body: safeLabel(label, args),
          level: "error",
        });
      }
      throw e;
    }
  };
}
