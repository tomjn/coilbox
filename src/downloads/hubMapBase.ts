/**
 * The hub address a map download asks for its sources (issue #5251).
 *
 * The address comes from a setting, which only a component can read, while the
 * download runs from the queue outside any component. `DownloadsProvider` keeps
 * this current, with null when the profile switched the hub off, and the map
 * walk reads it when a download starts. Null means no hub step. It is also the
 * hub a downloaded file is checked against and reported to (issue #5267).
 */
let base: string | null = null;

export function setHubMapBase(next: string | null): void {
  base = next;
}

export function getHubMapBase(): string | null {
  return base;
}
