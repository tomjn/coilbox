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
import { useMatchIconTypes } from "./useReplayUnits";

/** The icon type to draw a type the game does not define with. The engine
 *  draws the `default` one, and so does the game's answer from unitsync. */
const FALLBACK_TYPE = "default";

/**
 * The icon type of each of a recording's unit definitions, in the order of its
 * `unitDefs`, and null for a unit with no type to draw. A unit that names no
 * type has the game's `default`, which unitsync has already filled in.
 *
 * `matchTypes` is what the replay's analysis recorded for the units, by
 * lowercase name (#5340). The type the engine drew a unit with in that match
 * wins over the game's own, since a mod option or a tweak can change it. A type
 * the game's files do not define has no picture to draw, so the unit is drawn
 * as the `default` type, as the engine does.
 */
export function iconTypesOf(
  unitDefs: readonly string[],
  icons: Pick<UnitIconsResult, "unitTypes" | "types">,
  matchTypes?: ReadonlyMap<string, string>,
): (string | null)[] {
  return unitDefs.map((name) => {
    const key = name.toLowerCase();
    const matched = matchTypes?.get(key);
    if (matched !== undefined) {
      return Object.hasOwn(icons.types, matched) ? matched : FALLBACK_TYPE;
    }
    return icons.unitTypes[key] ?? null;
  });
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
  matchTypes: ReadonlyMap<string, string>,
): Promise<UnitIcons | null> {
  let result = answers.get(key);
  if (!result) {
    result = await shareInFlight(asked, key, () => unitsyncUnitIcons(args));
    answers.set(key, result);
  }
  const unitIcon = iconTypesOf(unitDefs, result, matchTypes);
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
 * The game is the replay's own, or the nearest version installed, which gives
 * the pictures and each unit's icon type as the game's files say it. Where the
 * replay's analysis recorded a unit's icon type for the match, that wins
 * (#5340). Nothing is asked of unitsync until `wanted` is true.
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
  // Waited for, so the icons are drawn once and not redrawn when it answers.
  const match = useMatchIconTypes(info.gameId, wanted);
  const [loaded, setLoaded] = useState<{
    key: string;
    icons: UnitIcons | null;
    unitDefs: readonly string[];
    matchTypes: ReadonlyMap<string, string>;
  } | null>(null);

  useEffect(() => {
    if (!key || !enginePath || !dataDir || !gameArchive || !match.ready) return;
    const matchTypes = match.types;
    let cancelled = false;
    loadUnitIcons(
      key,
      { enginePath, dataDir, gameArchive },
      unitDefs,
      matchTypes,
    )
      .then((icons) => {
        if (!cancelled) setLoaded({ key, icons, unitDefs, matchTypes });
      })
      // A game whose icons cannot be read is drawn as footprints.
      .catch(() => {
        if (!cancelled) setLoaded({ key, icons: null, unitDefs, matchTypes });
      });
    return () => {
      cancelled = true;
    };
  }, [key, enginePath, dataDir, gameArchive, unitDefs, match]);

  return loaded &&
    loaded.key === key &&
    loaded.unitDefs === unitDefs &&
    loaded.matchTypes === match.types
    ? loaded.icons
    : null;
}
