import raw from "../../../shared/map-catalog.json";

/**
 * The TypeScript half of the map catalog vocabulary (issue #1735), which #1738
 * is the first webview caller of.
 *
 * The Rust half is `crates/coilbox-map-catalog`, reading the same document with
 * `include_str!`, and the hub vendors it byte for byte through
 * `bun run sync:vendor`. Three copies of one number is two too many: the cap the
 * lookup splits on and the cap the hub refuses at have to be the same number, or
 * a client is told to make requests the hub answers with a 413.
 */

interface MapCatalogDocument {
  catalogVersion: number;
  caps: {
    haveKeys: number;
    submitMaps: number;
    submitBytes: number;
    lookupNames: number;
  };
}

const catalog = raw as MapCatalogDocument;

/** Which extraction produced an entry. Read rather than restated, so the number
 *  a client reports and the number the hub compares cannot drift. */
export const CATALOG_VERSION = catalog.catalogVersion;

/** How many names one `POST /api/v1/maps/lookup` may carry. */
export const MAX_LOOKUP_NAMES = catalog.caps.lookupNames;
