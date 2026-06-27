import { defineCommand } from "@picoframe/plugin-sdk";

/** A rapid repository from the master index. */
export interface Repo {
  name: string;
  url: string;
}

/** A downloadable content version within a repository. */
export interface Version {
  tag: string;
  name: string;
}

/**
 * Typed bindings to `plugin:coilbox-downloads|*`. The first `defineCommand`
 * argument is the Tauri ACL identifier (crate name minus `tauri-plugin-`), not
 * the npm package name. Argument keys are camelCase; Tauri maps them to the
 * crate's snake_case parameters.
 */
export const dlVersion = defineCommand<undefined, { version: string }>(
  "coilbox-downloads",
  "dl_version",
);

export const dlRepos = defineCommand<{ masterUrl?: string }, { repos: Repo[] }>(
  "coilbox-downloads",
  "dl_repos",
);

export const dlVersions = defineCommand<
  { repoUrl: string },
  { versions: Version[] }
>("coilbox-downloads", "dl_versions");

export const dlDownload = defineCommand<
  { tag: string; writePath?: string },
  { message: string; tag: string }
>("coilbox-downloads", "dl_download");
