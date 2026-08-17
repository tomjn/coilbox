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
 * - The caption is size and player count rather than the team shapes BAR draws
 *   start boxes for, since the boxes are not on this side's binding. See
 *   `../../assets/mapFacts.ts`.
 *
 * Unlike the rest of `./ItemPreview.tsx` this is a lookup rather than a reading
 * of the payload: every card asks unitsync, the hub and BAR's list what they have
 * of its map. One request each all the same, however many maps a pack names,
 * because the hub's asks are batched in `../../assets/heldPictures.ts` and BAR's
 * list is fetched once a session.
 */

import type { ReactNode } from "react";
import { useScanTargetSelection, useUnitsyncMinimap } from "@/content/config";
import { useBarMap } from "@/downloads/config";
import { MapPictureCard } from "../../assets/MapPicture";
import { mapFactsLabel } from "../../assets/mapFacts";
import { useMapPictureLadder } from "../../assets/useMapPicture";
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
 *  it and captioned with what BAR knows about it. */
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
  // Asked for whatever the ladder needed, because the caption wants the entry
  // even for a map that is installed and drew itself from its own archive. The
  // list is one fetch a session, so this is a second read of it and not a second
  // request.
  const bar = useBarMap(name);

  return (
    <MapPictureCard
      mapName={name}
      ladder={ladder}
      // BAR's own spelling where it lists the map, since that is the name a
      // player sees in a lobby. The pack's own name otherwise, which is all
      // anything here knows it by.
      label={bar?.displayName ?? name}
      detail={mapFactsLabel(bar)}
      className="h-full w-full"
    />
  );
}
