import { dlVersions } from "./bindings";

/**
 * Beyond All Reason's own rapid master, used for Beyond All Reason and nothing
 * else.
 *
 * BAR is not on the springrts index, so this is the only way to install it. It
 * sits apart from `DEFAULT_RAPID_MASTERS` and the player's `rapidRepos` on
 * purpose. Those lists are walked for every game, and asking BAR's servers for
 * other games' content makes BAR pay to serve or look up files that are not
 * theirs. The plugin's `dl_download` refuses this master for any tag outside
 * the `byar` repository too.
 */
export const BAR_RAPID_MASTER = "https://repos-cdn.beyondallreason.dev";
const BAR_RAPID_REPO = `${BAR_RAPID_MASTER}/byar`;

/** True for a game name BAR publishes, such as "Beyond All Reason test-32096-66fbac2". */
export function isBarGame(gameName: string): boolean {
  return gameName.startsWith("Beyond All Reason ");
}

/**
 * The exact `byar` tag for a BAR game name, read from BAR's `versions.gz`, or
 * null when BAR does not list it.
 *
 * A `byar:git:` tag is chosen over a moving one such as `byar:test`, because
 * `byar:test` can point at a newer build by the time pr-downloader reads it.
 * Passing pr-downloader an exact tag also means it never has to search for the
 * name.
 *
 * The index is read as fetched this launch, and fetched again when the name is
 * missing from it, since BAR publishes new test builds through the day.
 */
export async function resolveBarTag(gameName: string): Promise<string | null> {
  const find = async (fresh: boolean) => {
    const { versions } = await dlVersions({
      repoUrl: BAR_RAPID_REPO,
      ...(fresh ? { refresh: true } : { revalidate: true }),
    });
    const named = versions.filter(
      (v) => v.name === gameName && v.tag.startsWith("byar:"),
    );
    return (
      named.find((v) => v.tag.startsWith("byar:git:"))?.tag ??
      named[0]?.tag ??
      null
    );
  };
  return (await find(false)) ?? (await find(true));
}
