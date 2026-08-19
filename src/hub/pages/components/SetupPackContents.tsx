/**
 * What a setup pack installs, under a heading per sort of thing (issue #1721).
 *
 * A pack was three boxed columns, games, engine and maps, whatever it held, so a
 * pack of four maps spent two thirds of the panel saying "None" and "Whatever you
 * have" and ran its actual contents together in the last third. Each sort now
 * gets a heading and the width of the panel, a sort the pack says nothing about
 * gets neither, and the maps are drawn rather than named.
 *
 * The website draws the same pack the same way, in `components/SetupPackContents.tsx`
 * in tomjn/coilbox-hub. Two things differ here, both because this side is a
 * client and not a page:
 *
 * - A map you already have is drawn from your own copy. The ladder in
 *   `../../assets/picture.ts` puts the unitsync render first, so a pack of maps
 *   sitting in your data directory is a shelf of your own minimaps and costs no
 *   request at all. Nothing says which of them are installed: what a pack is for
 *   is filling in the ones that are not, and the importer already reports that.
 * - The caption is size and player count, read off the hub's map catalog for
 *   the maps this machine has not got. See `../../maps/facts.ts`. It used to
 *   come from BAR's own map list, which went with the rest of their hosted
 *   content in #1729, and the catalog is what puts it back (issue #1738).
 *
 * Unlike the rest of `./ItemPreview.tsx` this is a lookup rather than a reading
 * of the payload: every card asks unitsync and the hub what they have of its
 * map. One request each all the same, however many maps a pack names, because
 * the hub's asks are batched in `../../assets/heldPictures.ts` and
 * `../../maps/knownMaps.ts`.
 */

import type { ReactNode } from "react";
import { useScanTargetSelection, useUnitsyncMinimap } from "@/content/config";
import { MapPictureCard } from "../../assets/MapPicture";
import { useMapPictureLadder } from "../../assets/useMapPicture";
import { mapDisplayName, mapFactsLabel } from "../../maps/facts";
import { useMapFacts } from "../../maps/useMapFacts";
import type { SetupPackContents as PackContents } from "../../preview";

/**
 * The resolution a pack's minimaps are rendered at: `1024 >> 2` = 256px.
 *
 * A card in this grid is drawn at about 250 CSS px, so the 128px a battle row
 * asks for (`THUMB_MINIMAP_MIP`) would be visibly soft blown up to it, and the
 * full 1024px texture the map detail page needs is an extraction a pack of twenty
 * maps would pay for twenty times over.
 */
const PACK_MINIMAP_MIP = 2;

export function SetupPackContents({ pack }: { pack: PackContents }) {
  // One target for the whole grid rather than one per card: every card renders
  // the same session's engine and data directory, and it is a settings read.
  const { selected } = useScanTargetSelection();

  return (
    <div className="flex flex-col gap-8">
      {pack.games.length > 0 && (
        <Section title={pack.games.length === 1 ? "Game" : "Games"}>
          <ul className="flex flex-col gap-1 text-sm">
            {pack.games.map((game) => (
              <li key={game}>{game}</li>
            ))}
          </ul>
        </Section>
      )}

      {pack.engine && (
        <Section title="Engine">
          <p className="text-sm">{pack.engine}</p>
        </Section>
      )}

      {pack.maps.length > 0 && (
        <Section title={pack.maps.length === 1 ? "Map" : "Maps"}>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {pack.maps.map((name) => (
              // A row of maps is a row of different shapes, so each card is the
              // height of the row and the names line up along the bottom of it
              // rather than wherever each picture happens to end.
              <li key={name} className="flex">
                <PackMap
                  name={name}
                  enginePath={selected?.enginePath}
                  dataDir={selected?.rootPath}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One map a pack installs, drawn from the best picture this session can find of
 *  it and captioned with what the hub knows about it. */
function PackMap({
  name,
  enginePath,
  dataDir,
}: {
  name: string;
  enginePath?: string;
  dataDir?: string;
}) {
  const minimap = useUnitsyncMinimap(
    enginePath,
    dataDir,
    name,
    PACK_MINIMAP_MIP,
  );
  const ladder = useMapPictureLadder(name, minimap.url);
  // Only for a map this machine has not got. An installed one is drawing itself
  // from its own archive above, and its size and start positions are in that
  // archive too, so asking the hub would be a request for something already
  // here (issue #1738).
  const facts = useMapFacts(minimap.url ? undefined : name);

  return (
    <MapPictureCard
      mapName={name}
      ladder={ladder}
      // The hub's spelling where it has one, since a pack names a map by its
      // spring name and that is not what a player reads in a lobby. The pack's
      // own name otherwise, which is all anything here knows it by.
      label={mapDisplayName(facts) ?? name}
      detail={mapFactsLabel(facts)}
      className="h-full w-full"
    />
  );
}
