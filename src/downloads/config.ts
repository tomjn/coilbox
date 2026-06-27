import { useSetting } from "@picoframe/frame";

/** A user-configured rapid master. `url` is the base; `dl_repos` appends `/repos.gz`. */
export interface RapidRepo {
  id: string;
  name: string;
  url: string;
}

/**
 * The downloads plugin's config, persisted through the frame settings store
 * (Tauri-backed) under a single key — same pattern as uberstress. Holds the list
 * of selectable rapid masters and the content root downloads are written into.
 */
export interface DownloadsConfig {
  rapidRepos: RapidRepo[];
  /** Id of the content-plugin root downloads write into (`--filesystem-writepath`). */
  writeRootId?: string;
}

/** Spring + BAR rapid masters ship pre-configured; the user can add more. */
export const defaultConfig: DownloadsConfig = {
  rapidRepos: [
    { id: "spring", name: "Spring", url: "https://repos.springrts.com" },
    {
      id: "bar",
      name: "Beyond All Reason",
      url: "https://repos-cdn.beyondallreason.dev",
    },
  ],
};

export function useDownloadsConfig() {
  return useSetting<DownloadsConfig>("downloads.config", defaultConfig);
}
