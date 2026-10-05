/**
 * Everything that can be wrong with a hand-made map folder. Each error has a
 * `code` to switch on, the facts behind it as fields, and a `message` written
 * for the author: it names provinces by their name and colour, never by an
 * internal id or index.
 */
export type HandmadeMapError =
  /** `map.json` is not JSON at all. */
  | { code: "manifest-json"; message: string }
  /** A key in `map.json` is missing or holds a value the reader does not know. */
  | { code: "manifest-field"; path: string; message: string }
  /** Two provinces list the same colour. */
  | { code: "duplicate-color"; color: string; message: string }
  /** Two locations end up with the same id. */
  | { code: "duplicate-id"; id: string; message: string }
  /** The manifest names a file the folder does not hold. */
  | { code: "file-missing"; file: string; message: string }
  /** A location has both a scenario and a battle. */
  | { code: "scenario-and-battle"; id: string; name: string; message: string }
  /** A location's scenario file is not in the folder. */
  | {
      code: "scenario-missing";
      id: string;
      name: string;
      file: string;
      message: string;
    }
  /** A location's scenario file is not a scenario coilbox can play. */
  | {
      code: "scenario-invalid";
      id: string;
      name: string;
      file: string;
      message: string;
    }
  /** A location's scenario is for a different game than the map. */
  | {
      code: "scenario-wrong-game";
      id: string;
      name: string;
      file: string;
      /** The game the scenario names. */
      game: string;
      message: string;
    }
  /** An image is in the folder but cannot be decoded. */
  | { code: "image-unreadable"; file: string; message: string }
  /** The province image and the map picture are different sizes. */
  | {
      code: "size-mismatch";
      provinces: { width: number; height: number };
      picture: { width: number; height: number };
      message: string;
    }
  /** A colour is painted but no province lists it. `x` and `y` are a pixel
   * inside the region, counted from the top left of the province image. */
  | {
      code: "color-not-listed";
      color: string;
      x: number;
      y: number;
      message: string;
    }
  /** A province is listed but its colour is never painted. */
  | {
      code: "province-not-painted";
      id: string;
      name: string;
      color: string;
      message: string;
    }
  /** A location has no route to the rest of the map. `color` is absent for a
   * point location. */
  | {
      code: "unreachable";
      id: string;
      name: string;
      color?: string;
      message: string;
    }
  /** A faction has no capital, or more than one. */
  | {
      code: "capital-count";
      factionId: string;
      factionName: string;
      /** Names of the capitals found: empty, or two and more. */
      capitals: string[];
      message: string;
    }
  /** A crossing, blocked border or road names a location that does not exist. */
  | {
      code: "unknown-location";
      list: "crossings" | "blockedBorders" | "roads";
      id: string;
      message: string;
    }
  /** A blocked border is listed between two provinces that do not touch. */
  | {
      code: "blocked-border-not-touching";
      a: string;
      b: string;
      message: string;
    }
  /** The same pair is both blocked and joined by a crossing or a road. */
  | { code: "link-conflict"; a: string; b: string; message: string }
  /** A location's Warpath kind is not one Warpath knows. */
  | { code: "warpath-kind"; name: string; kind: string; message: string }
  /** The Warpath start or goal names a location that does not exist. */
  | {
      code: "warpath-unknown-location";
      end: "start" | "goal";
      id: string;
      message: string;
    }
  /** Only one of the Warpath start and goal is given. */
  | { code: "warpath-one-end"; missing: "start" | "goal"; message: string }
  /** The Warpath start and goal are the same location. */
  | { code: "warpath-same-location"; id: string; name: string; message: string }
  /** The Warpath start or goal is also marked with a kind. */
  | {
      code: "warpath-kind-on-end";
      end: "start" | "goal";
      id: string;
      name: string;
      kind: string;
      message: string;
    }
  /** The Warpath goal cannot be reached from the start. */
  | {
      code: "warpath-route";
      startId: string;
      goalId: string;
      message: string;
    };

export type HandmadeMapErrorCode = HandmadeMapError["code"];
