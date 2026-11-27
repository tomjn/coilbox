/**
 * The rapid master indexes shipped pre-configured.
 *
 * A master lists repositories (`<url>/repos.gz`), and pr-downloader searches
 * exactly the one it is pointed at, so anything resolving a game by name tries
 * each of these rather than assuming one.
 *
 * Beyond All Reason's own master (`repos-cdn.beyondallreason.dev`) used to ship
 * here and no longer does. Every game walks this list, and BAR's servers should
 * only ever be asked for BAR. BAR itself is installed from that master through
 * `barRapid.ts`, which is used for BAR's game and nothing else. This list only
 * seeds the `downloads.config` setting, it does not overwrite one.
 *
 * Kept apart from `config.ts` so the download paths, which are plain modules,
 * can read it without pulling in the settings hooks.
 */
export interface RapidMaster {
  id: string;
  name: string;
  /** Base URL. `/repos.gz` is appended to reach the index itself. */
  url: string;
}

export const DEFAULT_RAPID_MASTERS: RapidMaster[] = [
  { id: "spring", name: "Spring", url: "https://repos.springrts.com" },
];

/**
 * The repositories that can be read from. A row being typed in Sources can have
 * no address yet, and an empty address would make a Select item that Radix
 * refuses and a master the sidecar cannot fetch. A repeated address is kept
 * once, so it does not show twice in the Rapid repositories picker.
 */
export function usableRapidRepos<T extends { url: string }>(
  repos: readonly T[],
): T[] {
  const seen = new Set<string>();
  return repos.flatMap((r) => {
    const url = r.url.trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ ...r, url }];
  });
}
