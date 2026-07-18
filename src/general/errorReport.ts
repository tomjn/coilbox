/**
 * Repo constants + pure helpers for turning a caught render error into a
 * copy-pasteable report and a prefilled GitHub "new issue" URL. Kept separate
 * from `ErrorBoundary` (a class component) so the formatting is unit-testable
 * and free of React/DOM.
 */

export const REPO = "tomjn/coilbox";
export const REPO_URL = `https://github.com/${REPO}`;
export const ISSUE_URL = `${REPO_URL}/issues/new/choose`;
export const API_URL = `https://api.github.com/repos/${REPO}`;

/**
 * Browsers and GitHub both cap URL length; keep the whole `?title=&body=` URL
 * comfortably under this. The Copy button carries the untruncated report, so
 * truncating the link body loses nothing a reporter can't paste in full.
 */
const MAX_URL_LENGTH = 7000;

export interface ErrorReport {
  message: string;
  route: string;
  jsStack?: string;
  componentStack?: string;
  version?: string;
}

/** Markdown block a user copies into an issue (or we prefill the issue with). */
export function formatErrorReport(d: ErrorReport): string {
  const lines = [`**Route:** ${d.route || "(unknown)"}`];
  if (d.version) lines.push(`**Version:** ${d.version}`);
  lines.push("", `**Error:** ${d.message}`);
  if (d.jsStack) {
    lines.push(
      "",
      "<details><summary>Stack</summary>",
      "",
      "```",
      d.jsStack,
      "```",
      "</details>",
    );
  }
  if (d.componentStack) {
    lines.push(
      "",
      "<details><summary>Component stack</summary>",
      "",
      "```",
      d.componentStack.trim(),
      "```",
      "</details>",
    );
  }
  return lines.join("\n");
}

/**
 * Prefilled new-issue URL. `body` is truncated (on the raw string, before
 * encoding) so the final URL stays under {@link MAX_URL_LENGTH}; a marker is
 * appended so it's obvious the link was clipped.
 */
export function newIssueUrl(
  body: string,
  title = "Crash: unexpected render error",
): string {
  const base = `${REPO_URL}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=`;
  const budget = MAX_URL_LENGTH - base.length;
  let encoded = encodeURIComponent(body);
  if (encoded.length > budget) {
    const marker = "\n\n_(truncated - use Copy details for the full report)_";
    // Shrink the raw body until its encoded form + marker fits the budget.
    let raw = body;
    while (raw.length > 0) {
      encoded = encodeURIComponent(raw + marker);
      if (encoded.length <= budget) break;
      raw = raw.slice(0, Math.floor(raw.length * 0.9) - 1);
    }
  }
  return base + encoded;
}
