import { getAudioContext, getMasterGain } from "./context";
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
 * setting at play time, which is what keeps the preview button honest: it plays
 * through the same four nodes the real event will.
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

function levelValue(level: Level): number {
  return level.muted ? 0 : level.volume;
}

/**
 * A short ramp rather than a jumped value, so dragging a slider while a sound is
 * still decaying doesn't click. Matches the master gain's behaviour.
 */
function applyLevel(node: GainNode | undefined, level: Level) {
  const ctx = getAudioContext();
  if (!node || !ctx) return;
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
 * Play what this event sounds like right now. The only way anything in the app
 * makes a sound, so there is one place the player's settings have to be obeyed.
 */
export function playEvent(id: EventId) {
  const out = getEventGain(id);
  if (!out) return;
  SOUNDS[soundForEvent(id)].play(out);
}

// Dev-only hook for reading the whole chain back from devtools / tauri-mcp
// `execute_js`, the way `__coilboxMasterLevel` reads the master.
if (import.meta.env.DEV) {
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
          sound: soundForEvent(id),
        },
      ]),
    ),
  });
}
