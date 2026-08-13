/**
 * Turn a validated deep-link action into a concrete plan the handler can confirm
 * and then carry out (issue #388). Pure and app-state-free, so the trust-boundary
 * decisions (what an import is, whether this build can read it, where it routes)
 * are unit-testable directly.
 *
 * Import payloads pass through `identify()` from `../container/container.ts`,
 * which is the canonical validation gate: an `unknown` payload is rejected here,
 * a `newer` one is carried through with a warning, and a recognised one is routed
 * to the matching importer page. Each importer re-decodes and re-validates the
 * code itself (via `ResolveContentGate`, issue #387), so this is a pre-flight
 * check for the confirm dialog, not a replacement for the importer's own gate.
 */

import {
  asContainer,
  type Compatibility,
  type ContainerKind,
  decodeContainerText,
  identify,
} from "../container/container";
import { type OpenScreen, openScreenRoute } from "./parse";

/** Where a recognised import code should be sent, plus what to tell the user. */
export interface ImportPlan {
  kind: ContainerKind;
  version: number;
  compatibility: Compatibility;
  warnings: string[];
  /** The importer route, with the code carried as a `?import=` query param so
   * the target page runs its own decode plus `ResolveContentGate` flow. */
  route: string;
  /** A friendly noun for the confirm dialog, for example "warpath challenge". */
  label: string;
  /** What happens after the user agrees, when it is not the usual "the importer
   * resolves missing content and saves". Set for a kind that lands in the import
   * box instead of an importer. */
  detail?: string;
}

export type PrepareImportResult =
  | { ok: true; plan: ImportPlan }
  | { ok: false; reason: string };

/** Read a challenge container's game mode (`conquest` or `warpath`) so the code
 * routes to the right importer. Returns null when it is not a challenge. */
function challengeMode(code: string): "conquest" | "warpath" | null {
  const value = decodeContainerText(code);
  const container = asContainer(value);
  const payload = container?.payload as { mode?: unknown } | undefined;
  if (payload?.mode === "conquest") return "conquest";
  if (payload?.mode === "warpath") return "warpath";
  return null;
}

/** Carry the code to an importer route as a query param, url-encoded. */
function importRoute(base: string, code: string): string {
  return `${base}?import=${encodeURIComponent(code)}`;
}

/**
 * Gate an inline import code and resolve where it should go. Rejects an
 * unrecognised or unsupported payload, warns on a newer-version one, and maps a
 * recognised payload to its importer route. `campaign` is recognised but has no
 * code-import screen (it imports from a file), so it routes to the import box
 * (issue #1333), which names it and says where a campaign goes.
 *
 * A scenario routes to the player-facing Scenarios list rather than the builder,
 * because the builder is advanced-gated and a player handed a link has no reason
 * to be an author (issue #1336, following #861).
 */
export function prepareImport(code: string): PrepareImportResult {
  const id = identify(code);

  if (id.kind === "unknown") {
    // A newer-version container of an unknown kind still carries a hint.
    if (id.warnings.length > 0) return { ok: false, reason: id.warnings[0] };
    return { ok: false, reason: "This link is not a coilbox import." };
  }

  const base: Partial<ImportPlan> = {
    kind: id.kind,
    version: id.version,
    compatibility: id.compatibility,
    warnings: id.warnings,
  };

  switch (id.kind) {
    case "preset":
      return {
        ok: true,
        plan: {
          ...(base as ImportPlan),
          route: importRoute("/play/skirmish", code),
          label: "singleplayer preset",
        },
      };
    case "challenge": {
      const mode = challengeMode(code);
      if (mode === "conquest") {
        return {
          ok: true,
          plan: {
            ...(base as ImportPlan),
            route: importRoute("/conquest", code),
            label: "conquest challenge",
          },
        };
      }
      if (mode === "warpath") {
        return {
          ok: true,
          plan: {
            ...(base as ImportPlan),
            route: importRoute("/warpath", code),
            label: "warpath challenge",
          },
        };
      }
      return {
        ok: false,
        reason: "This challenge link is for an unknown game mode.",
      };
    }
    case "setup-pack":
      return {
        ok: true,
        plan: {
          ...(base as ImportPlan),
          route: importRoute("/downloads/maps", code),
          label: "setup pack",
        },
      };
    case "campaign":
      // A campaign has no code importer, so it lands in the import box (issue
      // #1333), which names it and says where a campaign file goes. That beats
      // the toast this used to be: a toast disappears and takes the code with
      // it, and the box keeps both on screen.
      return {
        ok: true,
        plan: {
          ...(base as ImportPlan),
          route: importRoute("/settings/import", code),
          label: "campaign",
          detail:
            "It opens in the import box, which says where a campaign goes.",
        },
      };
    case "scenario":
      return {
        ok: true,
        plan: {
          ...(base as ImportPlan),
          route: importRoute("/scenarios", code),
          label: "scenario",
        },
      };
    case "blueprint":
      // A layout is a coilbox container and the hub carries it, but on this
      // side a blueprint still only exists inside a scenario document, so there
      // is nowhere for a shared one to land. Saying that is better than routing
      // it at a screen that would quietly drop it. The library that will hold
      // one on its own is https://github.com/tomjn/coilbox/issues/1415, and it
      // is what turns this into a route.
      return {
        ok: false,
        reason:
          "That is a base blueprint. Coilbox has nowhere to keep a layout on its own yet, so it cannot import this.",
      };
    case "keymap":
      // The editor is where a keymap is read and written, so a shared one lands
      // there loaded rather than saved: nothing touches uikeys.txt until the
      // person who followed the link presses Save.
      return {
        ok: true,
        plan: {
          ...(base as ImportPlan),
          route: importRoute("/settings/engine-keybinds", code),
          label: "keymap",
          detail: "It opens in the keybinds editor, unsaved.",
        },
      };
  }
}

/** A friendly one-line summary of what an `open` link will do, for the confirm
 * dialog. */
export function describeOpen(action: {
  screen: OpenScreen;
  id?: string;
}): string {
  const route = openScreenRoute(action);
  switch (action.screen) {
    case "map":
      return `Open the map "${action.id}".`;
    case "game":
      return `Open the game "${action.id}".`;
    case "replay":
      return `Open the replay "${action.id}".`;
    case "conquest":
      return "Open Conquest.";
    case "warpath":
      return "Open Warpath.";
    case "battles":
      return "Open the battle list.";
    case "chat":
      return "Open chat.";
    default:
      return `Open ${route}.`;
  }
}
