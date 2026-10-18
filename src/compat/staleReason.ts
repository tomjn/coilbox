import type { CompatStale } from "./bindings";

/** One line for why a built mutator is out of date. */
export function staleReason(why: CompatStale): string {
  switch (why.kind) {
    case "manifest":
      return `built from compatibility version ${why.built}, now ${why.now}`;
    case "writer":
      return `written by an older coilbox (writer ${why.built}, now ${why.now})`;
    case "baseChecksum":
      return "the game has changed since it was built";
    case "noMarker":
      return "its record of what it was built from is missing";
  }
}
