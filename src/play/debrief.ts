import type { DetectedResult } from "./detect";
import type { Participant } from "./participants";

/**
 * Pure post-skirmish debrief logic (issue #370), kept apart from the
 * Tauri-calling orchestration in `useSkirmishDebrief` for the same reason as
 * `detect.ts` — directly unit-testable without mocking plugin commands.
 */

export type DebriefOutcome = "victory" | "defeat" | "unknown";

/** Why the debrief couldn't read a demo-based `DetectedResult`: no replay was
 * found for the launch at all, or the one found failed to decode. */
export type DebriefReason = DetectedResult | "no-replay" | "decode-failed";

/** A human headline for the debrief panel. Every non-victory/defeat reason
 * collapses to "unknown" — never fabricate a winner from a partial result. */
export function describeOutcome(reason: DebriefReason): {
  outcome: DebriefOutcome;
  headline: string;
} {
  switch (reason) {
    case "victory":
      return { outcome: "victory", headline: "Victory!" };
    case "defeat":
      return { outcome: "defeat", headline: "Defeat." };
    case "no-replay":
      return {
        outcome: "unknown",
        headline: "Outcome unknown — no replay was found for this match.",
      };
    case "decode-failed":
      return {
        outcome: "unknown",
        headline: "Outcome unknown — the replay couldn't be read.",
      };
    default:
      return {
        outcome: "unknown",
        headline: "Outcome unknown — the winner couldn't be determined.",
      };
  }
}

/** Seconds -> `mm:ss` (or `h:mm:ss`), mirroring the replay pages' formatter
 * (`ReplaysPage`/`ReplayDetailPage`). */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The handicap nudges offered by "Rematch with a tweak" — a single quick
 * adjustment applied to every AI opponent. Deliberately simple: #354 is the
 * separate, richer per-AI difficulty control. */
export const HANDICAP_TWEAKS: readonly {
  value: string;
  label: string;
  delta: number;
}[] = [
  { value: "-10", label: "-10% AI handicap (easier)", delta: -10 },
  { value: "10", label: "+10% AI handicap (harder)", delta: 10 },
  { value: "25", label: "+25% AI handicap (harder)", delta: 25 },
];

/**
 * Bump every AI participant's handicap by `deltaPercent`, clamped to 0..100.
 * The "you" row and every other field are left untouched. A result that
 * clamps back to 0 clears the field (undefined = 0, not emitted — matches
 * `Participant.handicap`'s convention) rather than persisting an explicit 0.
 * Returns a new array; a no-op input still returns a fresh (but equal) copy,
 * since the caller always wants a distinct object to launch and persist.
 */
export function bumpAiHandicap(
  participants: Participant[],
  deltaPercent: number,
): Participant[] {
  return participants.map((p) => {
    if (p.kind !== "ai") return p;
    const next = Math.max(0, Math.min(100, (p.handicap ?? 0) + deltaPercent));
    return next === 0
      ? { ...p, handicap: undefined }
      : { ...p, handicap: next };
  });
}
