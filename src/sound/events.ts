import type { SoundId } from "./library";

/**
 * The things that happen in coilbox that make a noise, and nothing about what
 * that noise is. Each names a sound from the library as its default, and a
 * player can point it at a different one without either the event or the sound
 * changing.
 *
 * Ids are persisted in settings keys, so they are stable.
 */

/** The volume and mute groups a player gets, above the individual events. */
export const GROUPS = {
  alerts: {
    label: "Alerts",
    description: "Sounds that want your attention, like a ring or a mention.",
  },
  ui: {
    label: "Interface",
    description: "Small sounds as you use Coilbox itself.",
  },
} as const satisfies Record<string, { label: string; description: string }>;

export type GroupId = keyof typeof GROUPS;

export const GROUP_IDS = Object.keys(GROUPS) as GroupId[];

type EventDef = {
  label: string;
  /** When it fires, shown under the name in the events table. */
  description: string;
  group: GroupId;
  sound: SoundId;
  /**
   * Off the events table, but still an event. Matchmaking has a route and no
   * way to reach it from the navigation, so a row for it would be a setting for
   * something a player cannot open. Drop this once matchmaking is reachable.
   */
  hidden?: true;
};

export const EVENTS = {
  ring: {
    label: "Rung by the host",
    description: "An autohost rings the battle room to round up idle players.",
    group: "alerts",
    sound: "gong",
  },
  mention: {
    label: "Mentioned in chat",
    description:
      "Someone says your name, or one of your highlight words, in chat or a private message.",
    group: "alerts",
    sound: "ping",
  },
  hostIngame: {
    label: "The host starts the game",
    description: "The founder of the battle you are in goes in game.",
    group: "alerts",
    sound: "chime",
  },
  matchFound: {
    label: "A match is found",
    description: "Matchmaking pairs you up and starts the accept countdown.",
    group: "alerts",
    sound: "gong",
    hidden: true,
  },
} as const satisfies Record<string, EventDef>;

export type EventId = keyof typeof EVENTS;

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

/** The events a player can see and change, in the order the table lists them. */
export const VISIBLE_EVENT_IDS = EVENT_IDS.filter(
  (id) => !("hidden" in EVENTS[id]),
);

/**
 * The groups with at least one event a player can see. A group whose events are
 * all hidden, or that has none yet, would be a slider controlling nothing.
 */
export const VISIBLE_GROUP_IDS = GROUP_IDS.filter((group) =>
  VISIBLE_EVENT_IDS.some((id) => EVENTS[id].group === group),
);

/** Settings keys. Unset means "the default", which is why none are written eagerly. */
export const eventVolumeKey = (id: EventId) => `sound.events.${id}.volume`;
export const eventMutedKey = (id: EventId) => `sound.events.${id}.muted`;
export const eventSoundKey = (id: EventId) => `sound.events.${id}.sound`;
export const groupVolumeKey = (id: GroupId) => `sound.groups.${id}.volume`;
export const groupMutedKey = (id: GroupId) => `sound.groups.${id}.muted`;
