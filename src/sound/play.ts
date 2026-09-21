import { play as cuelumePlay, setVolume as setCuelumeVolume } from "cuelume";
import {
  getAudioContext,
  getMasterGain,
  getMasterLevel,
  getMasterVolume,
} from "./context";
import {
  EVENT_IDS,
  EVENTS,
  type EventId,
  GROUP_IDS,
  type GroupId,
} from "./events";
import { SOUNDS, type SoundId } from "./library";

/**
 * Where an event becomes a sound at a level.
 *
 * Each event gets a gain node feeding its group's gain node, which feeds the
 * master gain, which feeds the speakers. So the final level is the master times
 * the group times the event times whatever the sound itself is built at, and a
 * mute anywhere on that path silences it by zeroing one node. Nothing checks a
 * setting at play time.
 *
 * `previewEvent` is the one exception, and it takes its own route to the
 * speakers past those nodes. See the note there.
 *
 * Levels are held here rather than read from the settings store, because events
 * fire from plain functions in the lobby event loop that cannot reach React.
 * SoundProvider pushes them in.
 */

type Level = { volume: number; muted: boolean };

const FULL: Level = { volume: 1, muted: false };

const groupLevels = new Map<GroupId, Level>();
const eventLevels = new Map<EventId, Level>();
const eventSounds = new Map<EventId, SoundId>();
const groupGains = new Map<GroupId, GainNode>();
const eventGains = new Map<EventId, GainNode>();
/** The preview button's own nodes, straight to the speakers. See `previewEvent`. */
const previewGains = new Map<EventId, GainNode>();

function levelValue(level: Level): number {
  return level.muted ? 0 : level.volume;
}

/**
 * A short ramp rather than a jumped value, so dragging a slider while a sound is
 * still decaying doesn't click. Matches the master gain's behaviour.
 *
 * The node is checked before the context is asked for, and that order is the
 * whole point: `getAudioContext` builds the context if it does not exist, and
 * SoundProvider pushes every stored level in on mount, long before the player
 * has clicked anything. Asking first built the one AudioContext the app owns
 * with no user activation behind it, and WebKit permanently refuses to let such
 * a context reach the speakers. It still reports "running" and still advances
 * its clock, so every sound was scheduled and none was ever heard.
 *
 * There is no node to ramp until something has played anyway, which only
 * happens after a gesture, so nothing is lost by waiting.
 */
function applyLevel(node: GainNode | undefined, level: Level) {
  if (!node) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  node.gain.setTargetAtTime(levelValue(level), ctx.currentTime, 0.015);
}

function getGroupGain(id: GroupId): GainNode | null {
  const existing = groupGains.get(id);
  if (existing) return existing;
  const ctx = getAudioContext();
  const master = getMasterGain();
  if (!ctx || !master) return null;
  const node = ctx.createGain();
  node.gain.value = levelValue(groupLevels.get(id) ?? FULL);
  node.connect(master);
  groupGains.set(id, node);
  return node;
}

function getEventGain(id: EventId): GainNode | null {
  const existing = eventGains.get(id);
  if (existing) return existing;
  const ctx = getAudioContext();
  const group = getGroupGain(EVENTS[id].group);
  if (!ctx || !group) return null;
  const node = ctx.createGain();
  node.gain.value = levelValue(eventLevels.get(id) ?? FULL);
  node.connect(group);
  eventGains.set(id, node);
  return node;
}

/** `volume` is 0..1. Safe to call before the node exists, as the slider can move first. */
export function setGroupLevel(id: GroupId, volume: number, muted: boolean) {
  const level = { volume: Math.min(1, Math.max(0, volume)), muted };
  groupLevels.set(id, level);
  applyLevel(groupGains.get(id), level);
}

/** `volume` is 0..1. Safe to call before the node exists, as the slider can move first. */
export function setEventLevel(id: EventId, volume: number, muted: boolean) {
  const level = { volume: Math.min(1, Math.max(0, volume)), muted };
  eventLevels.set(id, level);
  applyLevel(eventGains.get(id), level);
}

/** Point an event at a different sound. `null` puts it back to its default. */
export function setEventSound(id: EventId, sound: SoundId | null) {
  if (sound) eventSounds.set(id, sound);
  else eventSounds.delete(id);
}

/** The sound an event currently plays, its own choice or its default. */
export function soundForEvent(id: EventId): SoundId {
  return eventSounds.get(id) ?? EVENTS[id].sound;
}

/**
 * The volume an event should come out at, as a single number.
 *
 * Only needed for cuelume, which plays on an AudioContext of its own and takes
 * a multiplier rather than a node to connect to. Read from the same levels the
 * gain nodes are built from, so the two kinds of sound cannot disagree about
 * how loud the player asked for.
 */
function effectiveLevel(id: EventId): number {
  return (
    getMasterLevel() *
    levelValue(groupLevels.get(EVENTS[id].group) ?? FULL) *
    levelValue(eventLevels.get(id) ?? FULL)
  );
}

/**
 * Play what this event sounds like right now. The only way anything in the app
 * makes a sound, so there is one place the player's settings have to be obeyed.
 */
export function playEvent(id: EventId) {
  try {
    const sound = SOUNDS[soundForEvent(id)];
    if (sound.kind === "cuelume") {
      // cuelume's volume is global and read when the sound starts, so it has to
      // be set immediately before each play. Unlike our own sounds, one already
      // playing cannot be turned down.
      setCuelumeVolume(effectiveLevel(id));
      cuelumePlay(sound.name);
      return;
    }
    const out = getEventGain(id);
    if (!out) return;
    sound.play(out);
  } catch (e) {
    // A cue is a decoration on something else that is actually happening. It is
    // called from the lobby event loop and from `notify()`, which promises its
    // callers it never throws, so a refused or closed AudioContext must not
    // take the thing it was announcing down with it. cuelume owns a context of
    // its own, so it is the likelier of the two to fail out from under us.
    console.warn(`sound: ${id} failed to play`, e);
  }
}

/**
 * What the preview button plays at: the three volumes multiplied together, with
 * every mute on the way ignored.
 *
 * Volumes are obeyed because their sliders sit on the same page as the button,
 * so a quiet preview explains itself. A mute does not: the Interface group
 * ships muted, and its switch is in a different section from the two rows it
 * silences, so obeying it made those buttons look broken.
 */
function previewLevel(id: EventId): number {
  return (
    getMasterVolume() *
    (groupLevels.get(EVENTS[id].group) ?? FULL).volume *
    (eventLevels.get(id) ?? FULL).volume
  );
}

/**
 * Play an event's sound because the player asked to hear it, rather than
 * because the event happened. Returns how many seconds it will sound for, or 0
 * if it could not play, so a button can show that it is playing.
 *
 * Takes its own gain node straight to the speakers instead of the event ->
 * group -> master chain, because those nodes carry the mutes this deliberately
 * ignores. Pressing play always makes a sound.
 */
export function previewEvent(id: EventId): number {
  try {
    const sound = SOUNDS[soundForEvent(id)];
    if (sound.kind === "cuelume") {
      setCuelumeVolume(previewLevel(id));
      cuelumePlay(sound.name);
      return sound.seconds;
    }
    const ctx = getAudioContext();
    if (!ctx) return 0;
    if (ctx.state === "suspended") void ctx.resume();
    // Kept in a map like every other node here rather than built per press.
    // WebKit collects an audio node nothing holds a reference to, and a
    // collected gain takes the sound hanging off it with it.
    let out = previewGains.get(id);
    if (!out) {
      out = ctx.createGain();
      out.connect(ctx.destination);
      previewGains.set(id, out);
    }
    out.gain.value = previewLevel(id);
    sound.play(out);
    return sound.seconds;
  } catch (e) {
    console.warn(`sound: preview of ${id} failed to play`, e);
    return 0;
  }
}

/**
 * Cut a preview short.
 *
 * Only reaches coilbox's own sounds. cuelume plays on an AudioContext it owns
 * and exposes no way to stop one, so the last of those (1.1s at the outside)
 * finishes on its own. Ramped rather than zeroed so cutting a gong off does not
 * click.
 */
export function stopPreview(id: EventId) {
  const ctx = getAudioContext();
  const out = previewGains.get(id);
  if (!ctx || !out) return;
  out.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
}

// Dev-only hook for reading the whole chain back from devtools / tauri-mcp
// `execute_js`, the way `__coilboxMasterLevel` reads the master. Guarded on
// `window` because `notify()` reaches this module, and plenty of tests import
// that in a plain node environment.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (
    window as unknown as { __coilboxSoundGraph?: () => unknown }
  ).__coilboxSoundGraph = () => ({
    groups: Object.fromEntries(
      GROUP_IDS.map((id) => [id, groupGains.get(id)?.gain.value ?? null]),
    ),
    events: Object.fromEntries(
      EVENT_IDS.map((id) => [
        id,
        {
          gain: eventGains.get(id)?.gain.value ?? null,
          preview: previewGains.get(id)?.gain.value ?? null,
          sound: soundForEvent(id),
        },
      ]),
    ),
  });
}
