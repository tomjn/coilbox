/**
 * The menu that picks how the unit is drawn: solid, as edges, or solid with
 * edges. The view settings bar opens it for every view, and in four views the
 * chip beside each quadrant's name opens it for that quadrant alone.
 */

import { useLingui } from "@lingui/react/macro";
import { Cuboid, Layers, type LucideIcon, SquareDashed } from "lucide-react";
import type { ReactElement } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DrawMode } from "./drawMode";

/** The face of each mode, on the button that opens the menu and in it. */
export const DRAW_MODE_ICONS: Record<DrawMode, LucideIcon> = {
  solid: Cuboid,
  wireframe: SquareDashed,
  both: Layers,
};

const DRAW_MODES: DrawMode[] = ["solid", "wireframe", "both"];

export function useDrawModeNames(): Record<DrawMode, string> {
  const { t } = useLingui();
  return {
    solid: t`Solid`,
    wireframe: t`Wireframe`,
    both: t`Solid with edges`,
  };
}

export function DrawModeMenu({
  heading,
  mode,
  onChange,
  align = "start",
  children,
}: {
  /** What the menu sets, such as a quadrant's name. None for no heading. */
  heading?: string;
  mode: DrawMode;
  onChange: (mode: DrawMode) => void;
  align?: "start" | "end";
  /** The button that opens it. */
  children: ReactElement;
}) {
  const names = useDrawModeNames();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {heading ? <DropdownMenuLabel>{heading}</DropdownMenuLabel> : null}
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => onChange(value as DrawMode)}
        >
          {DRAW_MODES.map((each) => {
            const Icon = DRAW_MODE_ICONS[each];
            return (
              <DropdownMenuRadioItem key={each} value={each} className="gap-2">
                <Icon className="size-4" aria-hidden />
                {names[each]}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
