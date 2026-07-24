/**
 * Download source ordering for games (issue #500).
 *
 * Project policy: fetch content from GitHub releases and known mirrors first,
 * and fall back to pr-downloader (rapid) only as a last resort. pr-downloader
 * only understands rapid and http rapid-style sources, so it fails outright for
 * games distributed elsewhere. SplinterFaction, which ships via GitHub releases,
 * is the case that surfaced this.
 *
 * This module is the single source of truth for the order, kept pure so it can
 * be unit-tested without touching Tauri. The imperative attempt loop in
 * `multiplayer/battle/downloadGame.ts` consumes it.
 */

export type GameSource = "github" | "springfiles" | "rapid";

/**
 * The sources to try, in order, for a game.
 *
 * - `github`: a declared GitHub release repo. Only included when a repo is known
 *   for the game and there's a write root to install into. Tried first because
 *   it's the only source that can reach GitHub-only games at all.
 * - `springfiles`: the springfiles catalog mirror (direct download). A known
 *   mirror, so it comes before pr-downloader. Needs a write root.
 * - `rapid`: pr-downloader. Always the final fallback, and the only step that
 *   works without a write root (the sidecar has its own default).
 */
export function gameSourceOrder(opts: {
  hasGithubRepo: boolean;
  hasWritePath: boolean;
}): GameSource[] {
  const order: GameSource[] = [];
  if (opts.hasGithubRepo && opts.hasWritePath) order.push("github");
  if (opts.hasWritePath) order.push("springfiles");
  order.push("rapid");
  return order;
}
