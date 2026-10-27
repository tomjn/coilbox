/**
 * The Terrain changes switch for one game (issue #4792).
 *
 * Shown next to the library's game list once one game is picked. It reads the
 * game's units itself, so it follows detection until it is moved.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Mountain } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useGameUnits } from "@/content/useGameUnits";
import { useTerrainChanges } from "../../terrainSwitch";

export function TerrainSwitch({
  gameName,
  shortname,
  compact = false,
}: {
  gameName: string;
  shortname?: string;
  /** Below the lg breakpoint, an icon stands in for the words, which stay for
   *  screen readers and in the tooltip. For a page header short of room. */
  compact?: boolean;
}) {
  const { t } = useLingui();
  const { units, archive } = useGameUnits(gameName, shortname);
  const { enabled, setEnabled } = useTerrainChanges(archive, units);
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="terrain-changes"
        checked={enabled === true}
        disabled={!archive}
        onCheckedChange={setEnabled}
      />
      <label
        htmlFor="terrain-changes"
        className="flex items-center gap-1 text-xs font-medium"
        title={compact ? t`Terrain changes` : undefined}
      >
        {compact && <Mountain className="size-4 lg:hidden" />}
        <span className={compact ? "max-lg:sr-only" : undefined}>
          <Trans>Terrain changes</Trans>
        </span>
      </label>
    </div>
  );
}
