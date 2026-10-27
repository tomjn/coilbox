/**
 * The Terrain changes switch for one game (issue #4792).
 *
 * Shown next to the library's game list once one game is picked. It reads the
 * game's units itself, so it follows detection until it is moved.
 */

import { Trans } from "@lingui/react/macro";
import { Switch } from "@/components/ui/switch";
import { useGameUnits } from "@/content/useGameUnits";
import { useTerrainChanges } from "../../terrainSwitch";

export function TerrainSwitch({
  gameName,
  shortname,
}: {
  gameName: string;
  shortname?: string;
}) {
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
      <label htmlFor="terrain-changes" className="text-xs font-medium">
        <Trans>Terrain changes</Trans>
      </label>
    </div>
  );
}
