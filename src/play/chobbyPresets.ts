import { t } from "@lingui/core/macro";
import { dedupePresetName } from "@/packs/manifest";
import { GRID, type StartRect } from "@/startbox/geometry";
import type { SkirmishAi } from "../content/bindings";
import type { SkirmishDraft } from "./drafts";
import {
  gameRandomSide,
  initialParticipants,
  makeAiParticipant,
  type Participant,
  RANDOM_SIDE,
  type Rgb,
} from "./participants";
import { parseStartRects } from "./presets";

/**
 * Converting between coilbox presets and the records in BYAR-Chobby's
 * `optionsPresets.json` (issue #1297).
 *
 * The file is one JSON object keyed by preset name. Each record can hold `Map`,
 * `Modoptions`, `Start Boxes`, `Bots` and `Multiplayer Battle Settings`, as
 * `gui_optionpresets_panel.lua` saves them. A record names no game.
 */

/** The file's name in a game's data folder. */
export const OPTIONS_PRESETS_FILE = "optionsPresets.json";

/** The one section a coilbox preset has nowhere to keep. */
const MULTIPLAYER_SECTION = "Multiplayer Battle Settings";

/** Sections that map onto a preset. Anything else in a record is dropped. */
const KEPT_SECTIONS = new Set(["Map", "Modoptions", "Start Boxes", "Bots"]);

type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The records in the text of an `optionsPresets.json`.
 *
 * Throws when Chobby would refuse the file: it renames a file it cannot decode
 * and starts again, so anything that fails here is a file coilbox must not
 * write over. Chobby writes a new file as `[]`, because its encoder cannot tell
 * an empty table from an empty array, so an empty array is no records.
 */
export function parseOptionsPresets(text: string): Record<string, unknown> {
  if (text.trim() === "") throw new Error(t`optionsPresets.json is empty.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(t`optionsPresets.json is not valid JSON: ${reason}`);
  }
  if (Array.isArray(parsed) && parsed.length === 0) return {};
  if (!isTable(parsed))
    throw new Error(t`optionsPresets.json is not a table of presets.`);
  return parsed;
}

/** What a record holds, for its row in the list. */
export interface ChobbyRecordSummary {
  map: string;
  options: number;
  bots: number;
  boxes: number;
  multiplayer: boolean;
}

export function describeChobbyRecord(record: unknown): ChobbyRecordSummary {
  const r = isTable(record) ? record : {};
  return {
    map: typeof r.Map === "string" ? r.Map : "",
    options: Object.keys(isTable(r.Modoptions) ? r.Modoptions : {}).length,
    bots: Object.keys(isTable(r.Bots) ? r.Bots : {}).length,
    boxes: Object.keys(boxesByAlly(r["Start Boxes"])).length,
    multiplayer: MULTIPLAYER_SECTION in r,
  };
}

/** A mod option as the strings a start script holds. `0`, `"0"` and `false`
 *  are one value, and Chobby has saved all three for the same option. */
function optionText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

/** A box edge, which Chobby has saved as a number and as a numeric string. */
function edge(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return undefined;
}

function toRect(v: unknown): StartRect | undefined {
  if (!isTable(v)) return undefined;
  const left = edge(v.left);
  const top = edge(v.top);
  const right = edge(v.right);
  const bottom = edge(v.bottom);
  if (
    left === undefined ||
    top === undefined ||
    right === undefined ||
    bottom === undefined
  )
    return undefined;
  return { left, top, right, bottom };
}

/**
 * Start boxes keyed by 0-based ally team, from either shape Lua's encoder
 * makes. Chobby holds them 1-based. A table with every index becomes an array,
 * with `null` where an ally team has no box. A table that came back from an
 * earlier decode keeps string keys and becomes an object.
 */
function boxesByAlly(section: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (Array.isArray(section)) {
    section.forEach((v, i) => {
      const rect = toRect(v);
      if (rect) out[String(i)] = rect;
    });
  } else if (isTable(section)) {
    for (const [key, v] of Object.entries(section)) {
      if (!/^\d+$/.test(key) || Number(key) < 1) continue;
      const rect = toRect(v);
      if (rect) out[String(Number(key) - 1)] = rect;
    }
  }
  return out;
}

function toColor(v: unknown): Rgb | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const [r, g, b] = v.map(Number);
  if (![r, g, b].every((c) => Number.isFinite(c))) return undefined;
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return [clamp(r), clamp(g), clamp(b)];
}

export interface ChobbyImportContext {
  /** The game the player has selected. Records name none, so this is the one
   *  the imported preset belongs to. */
  gameName: string;
  /** That game's sides in the order Chobby indexes them from 0. */
  sides: readonly string[];
  /** That game's AIs, for telling a Lua AI from a native one. Chobby saves
   *  only the short name. */
  ais: readonly Pick<SkirmishAi, "shortName" | "kind" | "name">[];
}

/**
 * A coilbox setup from one Chobby record, and the sections of the record that
 * had nowhere to go.
 *
 * The player is added at ally team 0. Chobby does not save who was playing, only
 * the bots. Start boxes switch the start positions to choose in-game, which is
 * what Chobby's battles use, and a record without any leaves them as fixed.
 */
export function chobbyRecordToDraft(
  record: unknown,
  ctx: ChobbyImportContext,
): { draft: SkirmishDraft; dropped: string[] } {
  const r = isTable(record) ? record : {};

  const modOptionValues: Record<string, string> = {};
  if (isTable(r.Modoptions)) {
    for (const [key, v] of Object.entries(r.Modoptions)) {
      const text = optionText(v);
      if (text !== undefined) modOptionValues[key] = text;
    }
  }

  const participants: Participant[] = [initialParticipants()[0]];
  if (isTable(r.Bots)) {
    for (const [name, raw] of Object.entries(r.Bots)) {
      if (!isTable(raw) || typeof raw.aiLib !== "string") continue;
      const shortName = raw.aiLib;
      const known = ctx.ais.find(
        (a) => a.shortName.toLowerCase() === shortName.toLowerCase(),
      );
      const bot = makeAiParticipant(participants, undefined, {
        kind: known?.kind ?? "native",
        shortName: known?.shortName ?? shortName,
        name: known?.name,
      });
      const ally = Number(raw.allyNumber);
      const side = typeof raw.side === "number" ? ctx.sides[raw.side] : "";
      const handicap = Number(raw.handicap);
      participants.push({
        ...bot,
        name,
        allyTeam: Number.isInteger(ally) && ally >= 0 ? ally : 0,
        side: side ?? "",
        color: toColor(raw.teamColor) ?? bot.color,
        ...(Number.isFinite(handicap) && handicap > 0 ? { handicap } : {}),
      });
    }
  }

  const startRects = parseStartRects(boxesByAlly(r["Start Boxes"]));

  return {
    draft: {
      participants,
      gameName: ctx.gameName,
      mapName: typeof r.Map === "string" ? r.Map : "",
      startPosType: startRects ? 2 : 0,
      ...(startRects ? { startRects } : {}),
      modOptionValues,
    },
    dropped: Object.keys(r).filter((k) => !KEPT_SECTIONS.has(k)),
  };
}

/**
 * A Chobby record from a coilbox setup.
 *
 * `Multiplayer Battle Settings` is left out because a preset does not hold
 * those values. Map options and restrictions have no section and are left out
 * too. `Start Boxes` is always written, because Chobby counts it in multiplayer
 * when a record has no multiplayer section, and it is written as the array
 * Chobby walks with `ipairs`: an ally team with no box gets the whole map, so
 * the walk does not stop short.
 *
 * Start boxes are only written for choose-in-game start positions. A draft
 * keeps old boxes when the player switches away, but a launch ignores them, so
 * writing them would bring back a layout the preset does not use.
 *
 * A bot's side is its index in `sides`, which must be the sides of the game the
 * preset belongs to. With no sides, or a side not among them, the side is left
 * out and Chobby uses the game's default.
 *
 * Numbers and booleans are written as such. Chobby reads `locked` for truth and
 * the string "false" is true in Lua, which is why that section is not written.
 */
export function presetToChobbyRecord(
  draft: SkirmishDraft,
  sides: readonly string[] | undefined,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  if (draft.mapName) record.Map = draft.mapName;
  if (Object.keys(draft.modOptionValues).length > 0)
    record.Modoptions = { ...draft.modOptionValues };

  const sideIndex = (side: string): number | undefined => {
    if (!sides) return undefined;
    const named =
      side === RANDOM_SIDE ? gameRandomSide(sides.map(asSide)) : side;
    const index = sides.indexOf(named ?? "");
    return index >= 0 ? index : undefined;
  };
  const bots: Record<string, unknown> = {};
  const names: string[] = [];
  for (const p of draft.participants) {
    if (p.kind !== "ai" || !p.ai) continue;
    const name = dedupePresetName(names, p.name);
    names.push(name);
    const side = sideIndex(p.side);
    bots[name] = {
      aiLib: p.ai.shortName,
      allyNumber: p.allyTeam,
      aiOptions: {},
      teamColor: [...p.color],
      ...(side !== undefined ? { side } : {}),
      ...(p.handicap ? { handicap: p.handicap } : {}),
    };
  }
  record.Bots = bots;

  const rects: Record<string, StartRect> =
    draft.startPosType === 2 ? (draft.startRects ?? {}) : {};
  const allies = Object.keys(rects).map(Number);
  const whole = { left: 0, top: 0, right: GRID, bottom: GRID };
  record["Start Boxes"] = Array.from(
    { length: allies.length > 0 ? Math.max(...allies) + 1 : 0 },
    (_, ally) => ({ ...(rects[String(ally)] ?? whole) }),
  );
  return record;
}

const asSide = (name: string) => ({ name });
