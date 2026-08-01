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
  gatedCount,
  gateTarget,
  NO_GATE,
  type PaletteGate,
  paletteGate,
  requiredRuntimeVersion,
} from "../../gating";
import { scenarioRoute } from "../../launch";
import type { Scenario } from "../../model";

export interface ScenarioGate {
  /** Why each condition and action type cannot be used, keyed by type name. */
  gate: PaletteGate;
  /** Which runtime the palette is measured against, when it stops anything. */
  note: string | null;
}

interface RuntimeStatus {
  installed: RuntimeMarker | null;
  available: RuntimeMarker | null;
}

const NOTHING: RuntimeStatus = { installed: null, available: null };

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
    if (!game) return { gate: NO_GATE, note: null };
    const { route, reason } = scenarioRoute({
      game,
      installed: status.installed?.version ?? null,
      required,
    });
    const gate = paletteGate(
      gateTarget(route, status.installed, status.available),
    );
    return { gate, note: gatedCount(gate) > 0 ? reason : null };
  }, [game, status, required]);
}
