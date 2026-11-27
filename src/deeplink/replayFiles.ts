import { plural, t } from "@lingui/core/macro";
import type { ReplayFileOffer } from "@/content/bindings";
import { errorText } from "@/lib/helpers";

/**
 * Adding a replay file dropped on the window to the replay library. This is
 * the part with no window in it: `DeepLinkHandler` owns the prompt, and the
 * Rust side (`content_inspect_replay_file`, `content_add_replay_file`) reads
 * the file and does the copy.
 */

const REPLAY = /\.(sdfz|sdf)$/i;

export function isReplayPath(path: string): boolean {
  return REPLAY.test(path);
}

/** A replay file coilbox has read, with where it came from. */
export type ReplayOffer = ReplayFileOffer & { path: string };

type Inspect = (args: {
  path: string;
  root: string;
}) => Promise<{ offer: ReplayFileOffer }>;

/**
 * Read each file and sort it into replays to add, replays of matches the
 * library already has, and refusals with the reason.
 */
export async function planReplays(
  paths: string[],
  root: string,
  inspect: Inspect,
): Promise<{ offers: ReplayOffer[]; held: ReplayOffer[]; refused: string[] }> {
  const offers: ReplayOffer[] = [];
  const held: ReplayOffer[] = [];
  const refused: string[] = [];
  for (const path of [...new Set(paths)]) {
    try {
      const { offer } = await inspect({ path, root });
      (offer.inLibrary ? held : offers).push({ path, ...offer });
    } catch (e) {
      refused.push(errorText(e));
    }
  }
  return { offers, held, refused };
}

/** The sentence for a dropped replay whose match is already in the library. */
export function heldLine(offer: ReplayOffer): string {
  const { fileName } = offer;
  const inLibrary = offer.inLibrary ?? "";
  return t`${fileName} is a match already in your replay library, as ${inLibrary}.`;
}

/** The words of the prompt for a set of replays to add. */
export function describeReplayOffers(offers: ReplayOffer[]): {
  title: string;
  lines: string[];
} {
  if (offers.length === 1) {
    const [only] = offers;
    const { gameType, mapName, destDir } = only;
    return {
      title: t`Add a replay`,
      lines: [
        t`Add the replay of ${gameType} on ${mapName} to your replay library?`,
        t`A copy goes in ${destDir}.`,
      ],
    };
  }
  const destDir = offers[0].destDir;
  return {
    title: plural(offers.length, {
      one: "Add # replay",
      other: "Add # replays",
    }),
    lines: [
      ...offers.map((o) => {
        const { fileName, gameType, mapName } = o;
        return t`${fileName}, ${gameType} on ${mapName}.`;
      }),
      t`Copies go in ${destDir}.`,
    ],
  };
}

/**
 * Copy each offer into the library. One that fails does not stop the rest,
 * and each failure comes back with its reason.
 */
export async function addReplays(
  offers: ReplayOffer[],
  root: string,
  add: (args: { path: string; root: string }) => Promise<unknown>,
): Promise<{ added: ReplayOffer[]; failed: string[] }> {
  const added: ReplayOffer[] = [];
  const failed: string[] = [];
  for (const offer of offers) {
    try {
      await add({ path: offer.path, root });
      added.push(offer);
    } catch (e) {
      failed.push(errorText(e));
    }
  }
  return { added, failed };
}

/** The route of a replay's page in the library. */
export function replayRoute(fileName: string): string {
  return `/play/replays/${encodeURIComponent(fileName)}`;
}
