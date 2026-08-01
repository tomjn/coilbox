/**
 * The runtime a scenario's palette is measured against, read from the game the
 * scenario is set in.
 *
 * The game is resolved through the same scan the launcher and
 * {@link useGameUnits} use, so the editor gates on the game the engine would
 * actually load. Which of the two runtimes decides the palette is
 * {@link gateTarget}'s answer, from the route {@link scenarioRoute} would take.
 *
 * A game that is not installed, or a scan that has not answered yet, gates
 * nothing: an editor that greys the whole palette because a read is in flight is
 * worse than one that greys nothing.
 */

import { useEffect, useMemo, useState } from "react";
import { useUnitsyncScan } from "@/content/config";
import { usePreferredTarget } from "@/play/config";
import { type RuntimeMarker, scenarioRuntimeStatus } from "../../bindings";
import {
  type ExtensionTypes,
  NO_EXTENSIONS,
  parseExtensions,
} from "../../extensions";
import {
  gatedCount,
  gateTarget,
  NO_GATE,
  type PaletteGate,
  paletteGate,
  requiredRuntimeVersion,
} from "../../gating";
import { type ScenarioRoute, scenarioRoute } from "../../launch";
import type { Scenario } from "../../model";

export interface ScenarioGate {
  /** Why each condition and action type cannot be used, keyed by type name. */
  gate: PaletteGate;
  /**
   * The condition and action types the game declares for itself, which the
   * palette offers on top of coilbox's own.
   *
   * Ungated, unlike the rest of the palette. An extension type is the game's to
   * implement, so it runs on either route: the mutator is stacked on the game,
   * so the game's own `missions/extensions.lua` and its handler are in the VFS
   * underneath it either way.
   */
  extensions: ExtensionTypes;
  /** Which runtime the palette is measured against, when it stops anything. */
  note: string | null;
  /**
   * How the scenario would reach the engine, and why, for the test button to
   * say before it launches. Null until the game is known, which is the same
   * condition that gates nothing.
   */
  route: ScenarioRoute | null;
  reason: string | null;
  /** The runtime this build of coilbox ships, which is the one a test mutator
   *  would carry. Null when it could not be read. */
  available: RuntimeMarker | null;
}

interface RuntimeStatus {
  installed: RuntimeMarker | null;
  available: RuntimeMarker | null;
  /** `missions/extensions.lua` as it evaluated, unread. */
  extensions: unknown;
}

const NOTHING: RuntimeStatus = {
  installed: null,
  available: null,
  extensions: null,
};

export function useScenarioGate(scenario: Scenario): ScenarioGate {
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const game =
    scan.data?.games.find((g) => g.name === scenario.setup.gameName) ?? null;
  const root = game?.primaryArchive.path;
  const [status, setStatus] = useState<RuntimeStatus>(NOTHING);

  useEffect(() => {
    if (!root) {
      setStatus(NOTHING);
      return;
    }
    let live = true;
    scenarioRuntimeStatus({ root })
      .then((read) => {
        if (live) setStatus(read);
      })
      .catch(() => {
        if (live) setStatus(NOTHING);
      });
    return () => {
      live = false;
    };
  }, [root]);

  const required = requiredRuntimeVersion(scenario);
  return useMemo(() => {
    const available = status.available;
    if (!game) {
      return {
        gate: NO_GATE,
        extensions: NO_EXTENSIONS,
        note: null,
        route: null,
        reason: null,
        available,
      };
    }
    const { route, reason } = scenarioRoute({
      game,
      installed: status.installed?.version ?? null,
      required,
    });
    const gate = paletteGate(
      gateTarget(route, status.installed, status.available),
    );
    // The game's own runtime is what an extension may not redefine, on top of
    // coilbox's tables, because a game running ahead of this build owns types
    // coilbox has no table for.
    const extensions = parseExtensions(status.extensions, [
      ...(status.installed?.conditions ?? []),
      ...(status.installed?.actions ?? []),
    ]);
    return {
      gate,
      extensions,
      note: gatedCount(gate) > 0 ? reason : null,
      route,
      reason,
      available,
    };
  }, [game, status, required]);
}
