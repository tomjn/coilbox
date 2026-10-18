/** Which host and file a failed download was fetching, when known. */
export interface FailureContext {
  host: string | null;
  filename: string | null;
}

/**
 * pr-downloader prefixes each line with its level, the source path it was built
 * from, the line and the function: `[Error] /a/b/Http.cpp:220:search():`. None
 * of it means anything to the person who pressed Download (issue #1871).
 */
const SIDECAR_PREFIX =
  /^\[\w+\]\s*.*?\.(?:cpp|cc|c|hpp|h):\d+:[\w:~<>]*\(\):\s*/gm;

export function stripSidecarPrefix(text: string): string {
  return text.replace(SIDECAR_PREFIX, "");
}

/**
 * The reason a download failed, in a sentence that names the host and the file
 * (issue #4577). The texts matched here are the ones the downloads plugin sends:
 * reqwest's status line, its own stall and timeout wording, and its
 * "error sending request" for a connection that was never made.
 *
 * When none of them matches, the sidecar's own last line is the best there is,
 * with the build path taken off the front.
 */
export function describeFailure(raw: string, ctx: FailureContext): string {
  const who = ctx.host ?? "the mirror";
  const file = ctx.filename ?? "the file";

  if (/cancel/i.test(raw)) return raw;

  const status = /HTTP status [^(]*\((\d{3})\b/i.exec(raw);
  if (status) return `${who} answered ${status[1]} for ${file}`;

  if (/stalled|no data received/i.test(raw)) {
    const minutes = /(\d+) minutes?/.exec(raw);
    return `${who} stopped sending ${file}${minutes ? ` for ${minutes[0]}` : ""}`;
  }

  if (/timed out|took too long|timeout/i.test(raw))
    return `${who} did not answer in time for ${file}`;

  if (
    /error sending request|connection (?:refused|reset|closed)|dns error|failed to connect/i.test(
      raw,
    )
  )
    return `could not connect to ${who} for ${file}`;

  return stripSidecarPrefix(raw);
}
