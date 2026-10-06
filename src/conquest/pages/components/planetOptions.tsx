import { PLANETS, planetOf } from "../../planets";
import { PlanetSwatch } from "./PlanetSwatch";

/** Surprise me, then each planet with a chip of its colours. */
export const PLANET_OPTIONS = [
  {
    value: "random",
    label: "Surprise me",
    icon: <PlanetSwatch planet="random" />,
  },
  ...PLANETS.map((id) => ({
    value: id,
    label: planetOf(id).label,
    icon: <PlanetSwatch planet={id} />,
  })),
];
