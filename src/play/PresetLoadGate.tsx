import { useLingui } from "@lingui/react/macro";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import type { PlayTarget } from "./config";
import {
  otherInstalledVersions,
  presetLoadRequirements,
  withoutGame,
} from "./presetLoad";
import type { PresetSelection } from "./presetParts";
import type { SkirmishPreset } from "./presets";

/** A saved preset waiting to be loaded, and how it is being loaded. */
export interface PendingLoad {
  preset: SkirmishPreset;
  selection: PresetSelection;
  /** `onto` is a version of the preset's game that is installed, standing in
   *  for the one that is not. `without` loads only what needs no game. */
  how?: { kind: "onto"; game: string } | { kind: "without" };
  /** The content check passed, so the load can run. */
  resolved?: boolean;
  /** Run once the preset has loaded. */
  then?: () => void;
}

/**
 * The content check a saved preset waits behind before it loads (issue #1302).
 *
 * The same gate an imported preset goes through, so a missing game or map is
 * offered for download from the sources the gate already uses. When the missing
 * game is the problem, it also lists the other ways to load: onto an installed
 * version of the same game, or without the game at all. A game version nobody
 * publishes cannot be told from one that is merely not downloaded yet until the
 * download is tried, so these are offered beside the download rather than after
 * it fails.
 */
export function PresetLoadGate({
  pending,
  installedGames,
  target,
  targetLoading,
  onChoose,
  onContinue,
  onCancel,
}: {
  pending: PendingLoad;
  /** Names of the installed games, as the page has them. */
  installedGames: readonly string[];
  target?: PlayTarget;
  targetLoading?: boolean;
  /** Load a different way. The gate then checks what that way needs. */
  onChoose: (next: PendingLoad) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const { preset, selection } = pending;
  const gameMissing =
    selection.parts.includes("game") &&
    !installedGames.includes(preset.gameName);

  const alternatives = gameMissing
    ? [
        ...otherInstalledVersions(preset.gameName, installedGames).map(
          (game) => ({
            label: t`Load onto ${game}`,
            onChoose: () =>
              onChoose({
                ...pending,
                preset: { ...preset, gameName: game },
                how: { kind: "onto", game },
              }),
          }),
        ),
        {
          label: t`Load without the game`,
          onChoose: () =>
            onChoose({
              ...pending,
              selection: withoutGame(selection),
              how: { kind: "without" },
            }),
        },
      ]
    : undefined;

  return (
    <ResolveContentGate
      title={t`Load this preset`}
      description={t`Some content this preset needs isn't installed. Download it below, or cancel to leave your setup as it is.`}
      requirements={presetLoadRequirements(preset, selection)}
      target={target}
      targetLoading={targetLoading}
      alternatives={alternatives}
      onContinue={onContinue}
      onCancel={onCancel}
    />
  );
}
