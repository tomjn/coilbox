import { Link } from "react-router";

/**
 * A remix made before issue #3861 changed the game named in its header and left
 * the game the engine actually loads, which is named in the first packet of the
 * recording. It plays on the game it was recorded with.
 *
 * Nothing here rewrites the file. A remix of the original is a new file, and the
 * link goes to the original's page where the Remix button already is.
 */
export function StaleRemixNotice({
  gameType,
  sourceGametype,
  originFilename,
  originInLibrary,
}: {
  gameType: string;
  sourceGametype?: string;
  originFilename?: string;
  originInLibrary: boolean;
}) {
  return (
    <p className="max-w-xl text-xs text-amber-600 dark:text-amber-400">
      An older coilbox made this remix, and it will play on{" "}
      {sourceGametype || "the game it was recorded with"}, not on {gameType}.{" "}
      {originInLibrary && originFilename ? (
        <>
          <Link
            to={`/play/replays/${encodeURIComponent(originFilename)}`}
            className="underline underline-offset-4"
          >
            Open the original replay
          </Link>{" "}
          and remix it again to get one that plays on {gameType}.
        </>
      ) : (
        <>
          The original replay is not in your library, so it cannot be made
          again.
        </>
      )}
    </p>
  );
}
