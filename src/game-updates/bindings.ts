import { defineCommand } from "@picoframe/plugin-sdk";

/** A downloadable asset within a GitHub release. */
export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

/** The latest GitHub release for a game's distribution repo. */
export interface ReleaseInfo {
  tag: string;
  name: string;
  /** Markdown changelog (may be empty). */
  body: string;
  assets: ReleaseAsset[];
}

/**
 * Fetch the latest release for an `owner/name` GitHub repo. The command validates
 * the slug and hits GitHub's `/releases/latest` (via the Rust downloads plugin, so
 * the User-Agent + CSP are handled server-side).
 */
export const dlGithubLatestRelease = defineCommand<
  { repo: string },
  ReleaseInfo
>("coilbox-downloads", "dl_github_latest_release");
