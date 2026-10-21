import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
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
    label: msg`Alerts`,
    description: msg`Sounds that want your attention, like a ring or a mention.`,
  },
  ui: {
    label: msg`Interface`,
    description: msg`Small sounds as Coilbox gets on with things.`,
    // Off until asked for. Interface sounds divide people, and a desktop app
    // that starts chirping after an update irritates before it delights.
    mutedByDefault: true,
  },
  music: {
    label: msg`Music`,
    description: msg`The soundtrack, whichever one you pick above.`,
  },
} as const satisfies Record<
  string,
  {
    label: MessageDescriptor;
    description: MessageDescriptor;
    mutedByDefault?: true;
  }
>;

/** Whether a group is silent for a player who has never opened Sound settings. */
export function groupMutedByDefault(id: GroupId): boolean {
  return "mutedByDefault" in GROUPS[id];
}

export type GroupId = keyof typeof GROUPS;

export const GROUP_IDS = Object.keys(GROUPS) as GroupId[];

type EventDef = {
  label: MessageDescriptor;
  /** When it fires, shown under the name in the events table. */
  description: MessageDescriptor;
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
    label: msg`Rung by the host`,
    description: msg`The host rings the battle room to round up idle players.`,
    group: "alerts",
    sound: "gong",
  },
  mention: {
    label: msg`Mentioned in chat`,
    description: msg`Someone says your name, or one of your highlight words, in chat or a private message.`,
    group: "alerts",
    sound: "ping",
  },
  hostIngame: {
    label: msg`The host starts the game`,
    description: msg`The founder of the battle you are in goes in game.`,
    group: "alerts",
    sound: "chime",
  },
  launch: {
    label: msg`You launch a game`,
    description: msg`Any launch of your own: a skirmish, a battle, a campaign mission, a saved game or a replay.`,
    group: "alerts",
    sound: "cue-ready",
  },
  matchFound: {
    label: msg`A match is found`,
    description: msg`Matchmaking pairs you up and starts the accept countdown.`,
    group: "alerts",
    sound: "gong",
    hidden: true,
  },
  uiSuccess: {
    label: msg`Something finished`,
    description: msg`A download completes, or anything else Coilbox tells you went well.`,
    group: "ui",
    sound: "cue-success",
  },
  uiError: {
    label: msg`Something failed`,
    description: msg`Coilbox reports that something went wrong.`,
    group: "ui",
    sound: "cue-error",
  },
} as const satisfies Record<string, EventDef>;

export type EventId = keyof typeof EVENTS;

export const EVENT_IDS = Object.keys(EVENTS) as EventId[];

/** The events a player can see and change, in the order the table lists them. */
export const VISIBLE_EVENT_IDS = EVENT_IDS.filter(
  (id) => !("hidden" in EVENTS[id]),
);

/** The groups the Sounds table splits its rows under, in group order. */
export const EVENT_GROUP_IDS = GROUP_IDS.filter((group) =>
  VISIBLE_EVENT_IDS.some((id) => EVENTS[id].group === group),
);

/**
 * The groups worth showing a player. A group whose events are all hidden, or
 * that has none yet, would be a slider controlling nothing.
 *
 * Music is the exception: it has no events, and whether it controls anything
 * depends on whether this build ships tracks, which only the profile knows.
 * Passed in rather than imported so this file stays a plain registry.
 */
export function visibleGroupIds(hasMusic: boolean): GroupId[] {
  return GROUP_IDS.filter((group) =>
    group === "music" ? hasMusic : EVENT_GROUP_IDS.includes(group),
  );
}

/** Settings keys. Unset means "the default", which is why none are written eagerly. */
export const eventVolumeKey = (id: EventId) => `sound.events.${id}.volume`;
export const eventMutedKey = (id: EventId) => `sound.events.${id}.muted`;
export const eventSoundKey = (id: EventId) => `sound.events.${id}.sound`;
export const groupVolumeKey = (id: GroupId) => `sound.groups.${id}.volume`;
export const groupMutedKey = (id: GroupId) => `sound.groups.${id}.muted`;
