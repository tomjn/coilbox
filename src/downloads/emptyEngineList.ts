/**
 * What the engine installer says when a source has nothing to offer.
 *
 * springfiles has two different empty lists and they need different answers.
 * On an arm64 machine it publishes no engines at all, so waiting or retrying
 * gets a player nowhere and the only route to an engine is the Recoil source.
 * Anywhere else an empty list is a fetch that came back short, which retrying
 * can fix. Issue #968 is the screen saying the same thing for both.
 */

/** Where the installer was asking. */
export type EngineSource = "recoil" | "springfiles";

export interface EmptyEngineList {
  source: EngineSource;
  /** The OS the Recoil release list was matched against, e.g. `macos`. */
  platform: string;
  /** Whether springfiles publishes engines for this kind of machine at all. */
  listsThisPlatform: boolean;
}

/** One sentence of why the list is empty, then what to do about it. */
export function emptyEngineListMessage({
  source,
  platform,
  listsThisPlatform,
}: EmptyEngineList): string {
  if (source === "recoil") {
    return `No Recoil builds for this platform (${platform}). On macOS, add an engine manually.`;
  }
  if (!listsThisPlatform) {
    return "springfiles has no engines for this kind of machine. Recoil does, so switch the source above to Recoil.";
  }
  return "springfiles has no engines to offer right now. Try again in a moment, or switch the source above to Recoil.";
}
