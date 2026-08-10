/**
 * The rapid master indexes shipped pre-configured.
 *
 * A master lists repositories (`<url>/repos.gz`), and pr-downloader searches
 * exactly the one it is pointed at. Games are spread across several: BAR
 * publishes its own and is absent from the springrts index entirely, so anything
 * resolving a game by name has to try each of these rather than assume one.
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
  {
    id: "bar",
    name: "Beyond All Reason",
    url: "https://repos-cdn.beyondallreason.dev",
  },
];
