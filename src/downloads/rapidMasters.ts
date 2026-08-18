/**
 * The rapid master indexes shipped pre-configured.
 *
 * A master lists repositories (`<url>/repos.gz`), and pr-downloader searches
 * exactly the one it is pointed at, so anything resolving a game by name tries
 * each of these rather than assuming one.
 *
 * Beyond All Reason's own master (`repos-cdn.beyondallreason.dev`) used to ship
 * here and no longer does, as part of coilbox retiring its use of BAR-hosted
 * infrastructure. BAR is absent from the springrts index, so the consequence is
 * that coilbox cannot install Beyond All Reason itself until a coilbox-hosted
 * route exists. A player who wants it meanwhile can add the master by hand in
 * Downloads, and anyone who already had it keeps it: this list only seeds the
 * `downloads.config` setting, it does not overwrite one.
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
