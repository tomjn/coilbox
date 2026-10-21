import { t } from "@lingui/core/macro";
import { PLANETS, planetOf } from "../../planets";
import { PlanetSwatch } from "./PlanetSwatch";

/** Surprise me, then each planet with a chip of its colours. */
export const PLANET_OPTIONS = [
  {
    value: "random",
    // Read when the picker draws, so it follows the language.
    get label() {
      return t`Surprise me`;
    },
    icon: <PlanetSwatch planet="random" />,
  },
  ...PLANETS.map((id) => ({
    value: id,
    label: planetOf(id).label,
    icon: <PlanetSwatch planet={id} />,
  })),
];
