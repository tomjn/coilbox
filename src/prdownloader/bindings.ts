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
 * Typed bindings to `plugin:coilbox-prdownloader|*`. The first `defineCommand`
 * argument is the Tauri ACL identifier (crate name minus `tauri-plugin-`), not
 * the npm package name. Argument keys are camelCase; Tauri maps them to the
 * crate's snake_case parameters.
 */
export const prdVersion = defineCommand<undefined, { version: string }>(
  "coilbox-prdownloader",
  "prd_version",
);

export const prdRepos = defineCommand<{ masterUrl?: string }, { repos: Repo[] }>(
  "coilbox-prdownloader",
  "prd_repos",
);

export const prdVersions = defineCommand<{ repoUrl: string }, { versions: Version[] }>(
  "coilbox-prdownloader",
  "prd_versions",
);

export const prdDownload = defineCommand<{ tag: string; writePath?: string }, { message: string; tag: string }>(
  "coilbox-prdownloader",
  "prd_download",
);
