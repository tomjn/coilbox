import { useEffect, useMemo, useState } from "react";
import { handmadeMapFileUrls } from "../handmade/library";
import type { GalaxyDoc } from "../model";
import type { PlacedModelSources } from "./placedModelLoaders";

/** The installed game a page reads `game` models out of, as far as it knows. */
export interface PlacedModelGame {
  enginePath?: string;
  dataDir?: string;
  gameArchive?: string;
  /** The installed games are still being scanned. */
  pending?: boolean;
}

type FileUrl = NonNullable<PlacedModelSources["fileUrl"]>;

/**
 * Where a map's placed models are read from, for `GalaxyView`. Only a document
 * that places models asks, and the object is stable so the scene is not
 * rebuilt. A `file` model is looked up in the hand-made map folder the
 * document's terrain picture came from.
 */
export function usePlacedModelSources(
  galaxy: Pick<GalaxyDoc, "models" | "terrain">,
  game: PlacedModelGame,
): PlacedModelSources | undefined {
  const hasModels = (galaxy.models?.length ?? 0) > 0;
  const image = galaxy.terrain?.image;
  // The picture whose folder is wanted, or undefined when no model is a file.
  const folderOf =
    image && galaxy.models?.some((m) => "file" in m.model) ? image : undefined;

  const [files, setFiles] = useState<{ image: string; fileUrl?: FileUrl }>();
  useEffect(() => {
    if (!folderOf) return;
    let live = true;
    handmadeMapFileUrls(folderOf).then(
      (fileUrl) => {
        if (live) setFiles({ image: folderOf, fileUrl });
      },
      (e) => {
        console.warn("could not list the map folder's files for its models", e);
        if (live) setFiles({ image: folderOf });
      },
    );
    return () => {
      live = false;
    };
  }, [folderOf]);
  const answered = files?.image === folderOf;
  const fileUrl = answered ? files?.fileUrl : undefined;

  // Until the scan and the folder listing answer, a model that is there looks
  // like one that is not, so the models wait instead of being reported missing.
  const pending =
    Boolean(game.pending) || (folderOf !== undefined && !answered);
  const { enginePath, dataDir, gameArchive } = game;
  return useMemo<PlacedModelSources | undefined>(() => {
    if (!hasModels) return undefined;
    if (pending) return { pending: true };
    const installed =
      enginePath && dataDir && gameArchive
        ? { enginePath, dataDir, gameArchive }
        : undefined;
    if (!installed && !fileUrl) return undefined;
    return { game: installed, fileUrl };
  }, [hasModels, pending, enginePath, dataDir, gameArchive, fileUrl]);
}
