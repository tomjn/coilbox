import { useEffect, useState } from "react";
import { unitsyncBuildpicUrl } from "../lib/assetUrl";
import {
  type DemoInfo,
  type UnitIconsResult,
  unitsyncUnitIcons,
} from "./bindings";
import { useScanTargetSelection, useUnitsyncScan } from "./config";
import { shareInFlight } from "./inFlight";
import { closestInstalledGame, recordedGame } from "./replayBuildOrders";
import {
  createUnitIcons,
  type IconType,
  type UnitIcons,
} from "./replayMapView/icons";

/**
 * The icon type of each of a recording's unit definitions, in the order of its
 * `unitDefs`, and null for a unit the game does not define. A unit that names
 * no type has the game's `default`, which unitsync has already filled in.
 */
export function iconTypesOf(
  unitDefs: readonly string[],
  icons: Pick<UnitIconsResult, "unitTypes">,
): (string | null)[] {
  return unitDefs.map((name) => icons.unitTypes[name.toLowerCase()] ?? null);
}

/** What unitsync said about each game's icons, by engine, data folder and game. */
const answers = new Map<string, UnitIconsResult>();
const asked = new Map<string, Promise<UnitIconsResult>>();
/** Pictures by URL, so a game's icon is read once however many replays use it. */
const pictures = new Map<string, Promise<HTMLImageElement | null>>();

function loadPicture(url: string): Promise<HTMLImageElement | null> {
  let picture = pictures.get(url);
  if (!picture) {
    picture = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    pictures.set(url, picture);
  }
  return picture;
}

/** For tests: forget what unitsync said and the pictures read. */
export function resetUnitMapIconsForTests(): void {
  answers.clear();
  asked.clear();
  pictures.clear();
}

/** The icons for a recording's units, or null when the game has none. */
async function loadUnitIcons(
  key: string,
  args: { enginePath: string; dataDir: string; gameArchive: string },
  unitDefs: readonly string[],
): Promise<UnitIcons | null> {
  let result = answers.get(key);
  if (!result) {
    result = await shareInFlight(asked, key, () => unitsyncUnitIcons(args));
    answers.set(key, result);
  }
  const unitIcon = iconTypesOf(unitDefs, result);
  const used = [...new Set(unitIcon)].filter(
    (name): name is string => name !== null,
  );
  const types = new Map<string, IconType>();
  await Promise.all(
    used.map(async (name) => {
      const type = result.types[name];
      if (!type?.file) return;
      const picture = await loadPicture(unitsyncBuildpicUrl(type.file));
      if (picture) types.set(name, { size: type.size, picture });
    }),
  );
  return types.size > 0 ? createUnitIcons(unitIcon, types) : null;
}

/**
 * The game's map icons for the units of a recording (#5316), or null while they
 * load and when the game has none, which the unit map draws as footprints.
 *
 * The game is the replay's own, or the nearest version installed, since an
 * icon type is a property of the game and not of the match. Nothing is asked of
 * unitsync until `wanted` is true.
 */
export function useUnitMapIcons(
  info: DemoInfo,
  unitDefs: readonly string[],
  wanted: boolean,
): UnitIcons | null {
  const { selected } = useScanTargetSelection();
  const scan = useUnitsyncScan(selected?.enginePath, selected?.rootPath);
  const game = scan.data
    ? closestInstalledGame(recordedGame(info), scan.data.games)
    : null;
  const enginePath = selected?.enginePath;
  const dataDir = selected?.rootPath;
  const gameArchive = game?.primaryArchive.name;
  const key =
    wanted && enginePath && dataDir && gameArchive
      ? `${dataDir}::${enginePath}::${gameArchive}`
      : undefined;
  const [loaded, setLoaded] = useState<{
    key: string;
    icons: UnitIcons | null;
    unitDefs: readonly string[];
  } | null>(null);

  useEffect(() => {
    if (!key || !enginePath || !dataDir || !gameArchive) return;
    let cancelled = false;
    loadUnitIcons(key, { enginePath, dataDir, gameArchive }, unitDefs)
      .then((icons) => {
        if (!cancelled) setLoaded({ key, icons, unitDefs });
      })
      // A game whose icons cannot be read is drawn as footprints.
      .catch(() => {
        if (!cancelled) setLoaded({ key, icons: null, unitDefs });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir, gameArchive, unitDefs]);

  return loaded && loaded.key === key && loaded.unitDefs === unitDefs
    ? loaded.icons
    : null;
}
