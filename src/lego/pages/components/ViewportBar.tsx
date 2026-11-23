/**
 * The unit builder's bar of view controls, in the bottom right of the viewport.
 *
 * Kept apart from the viewport so it can be rendered without a WebGL context:
 * everything it shows is a state the viewport owns and passes in. The pickers
 * that open a popover of their own come in as slots, because what they need to
 * do their job is the viewport's business, not the bar's.
 *
 * The on and off overlays are in one "Show" menu, so a player reads names
 * instead of icons. The axis compass, which turns the camera to a view or resets
 * it, is in the top right of the viewport rather than here.
 */

import { t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import {
  Cuboid,
  Keyboard,
  Layers,
  ListChecks,
  type LucideIcon,
  SquareDashed,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ViewButton,
  ViewControls,
  ViewToggle,
} from "@/components/ViewControls";
import { useShortcutOverrides } from "../../shortcutOverridesStore";
import { shortcutLabel } from "../../shortcuts";
import type { DrawMode } from "./drawMode";

/** Something in the view that is either on or off. */
export interface Toggle {
  on: boolean;
  onChange: (on: boolean) => void;
}

export interface ViewportBarProps {
  /** The problems button, absent when the page has no checks to list. */
  problems?: ReactNode;
  grid: Toggle;
  /** Whether a drag snaps. Alt frees one drag whatever this says. */
  snapping: Toggle;
  drawMode: DrawMode;
  onNextDrawMode: () => void;
  collision: Toggle;
  /** Absent for a unit with no skeleton. */
  skeleton?: Toggle;
  balance: Toggle;
  overlap: Toggle;
  /** The footprint check, and whether the barrel and the like are left out of
   *  it. Absent hides both. */
  footprint?: Toggle & {
    leaveOut: boolean;
    onLeaveOutChange: (leaveOut: boolean) => void;
  };
  aim: Toggle;
  /** Absent for a unit with no weapon ranges to draw. */
  reach?: Toggle;
  /** The pose list popover, absent where poses cannot be edited. */
  poses?: ReactNode;
  /** The guides popover, absent where guides cannot be edited. */
  guides?: ReactNode;
  /** Absent while there are no guides to hide. */
  guideVisibility?: Toggle;
  /** The backdrop and ground popover. */
  environment: ReactNode;
  /** The reference unit popover. */
  reference: ReactNode;
  /** Absent while the run has no stand-in. */
  standIn?: Toggle;
  /** Absent while the stand-in does not drive. */
  followDrive?: Toggle;
  /** Absent while the script has drawn no effect. */
  effects?: Toggle;
  onShortcuts: () => void;
}

/** The face of the draw mode button, which is the mode the unit is in. */
const DRAW_MODE_ICONS: Record<DrawMode, LucideIcon> = {
  solid: Cuboid,
  wireframe: SquareDashed,
  both: Layers,
};

/** What pressing the button does from each mode, naming the mode it goes to. */
const DRAW_MODE_TITLES: Record<DrawMode, (key: string) => string> = {
  solid: (key) => t`Draw the unit as edges (${key})`,
  wireframe: (key) => t`Draw the unit solid with edges (${key})`,
  both: (key) => t`Draw the unit solid (${key})`,
};

export function ViewportBar({
  problems,
  grid,
  snapping,
  drawMode,
  onNextDrawMode,
  collision,
  skeleton,
  balance,
  overlap,
  footprint,
  aim,
  reach,
  poses,
  guides,
  guideVisibility,
  environment,
  reference,
  standIn,
  followDrive,
  effects,
  onShortcuts,
}: ViewportBarProps) {
  const { t } = useLingui();
  // Re-render when a shortcut is rebound, so its tooltip keeps up.
  useShortcutOverrides();
  const DrawModeFace = DRAW_MODE_ICONS[drawMode];
  const skeletonKey = shortcutLabel("skeleton");
  /** The plain on and off overlays, in the order the menu lists them. A toggle
   *  the page does not offer is left out. */
  const items: ShowItem[] = [
    { id: "grid", name: t`Grid`, ...grid },
    {
      id: "snapping",
      name: t`Snapping`,
      shortcut: shortcutLabel("snapping"),
      ...snapping,
    },
    { id: "collision", name: t`Collision volume`, ...collision },
    ...(skeleton
      ? [
          {
            id: "skeleton",
            name: t`Skeleton`,
            shortcut: skeletonKey,
            ...skeleton,
          },
        ]
      : []),
    { id: "balance", name: t`Balance check`, ...balance },
    { id: "overlap", name: t`Overlap check`, ...overlap },
    ...(footprint
      ? [{ id: "footprint", name: t`Footprint check`, ...footprint }]
      : []),
    ...(footprint?.on
      ? [
          {
            id: "footprint-leave-out",
            name: t`Leave the barrel and similar out of the footprint`,
            on: footprint.leaveOut,
            onChange: footprint.onLeaveOutChange,
          },
        ]
      : []),
    { id: "aim", name: t`Aim point`, ...aim },
    ...(reach ? [{ id: "reach", name: t`Weapon ranges`, ...reach }] : []),
    ...(guideVisibility
      ? [{ id: "guides", name: t`Guides`, ...guideVisibility }]
      : []),
    ...(standIn
      ? [{ id: "stand-in", name: t`Stand-in unit`, ...standIn }]
      : []),
    ...(followDrive
      ? [
          {
            id: "follow-drive",
            name: t`Follow the driving unit`,
            ...followDrive,
          },
        ]
      : []),
    ...(effects
      ? [{ id: "effects", name: t`Script effects`, ...effects }]
      : []),
  ];
  return (
    <ViewControls className="pointer-events-auto shrink-0">
      {problems}
      <ShowMenu items={items} />
      <ViewButton
        title={DRAW_MODE_TITLES[drawMode](shortcutLabel("draw-mode"))}
        onClick={onNextDrawMode}
      >
        <DrawModeFace className="size-4" />
      </ViewButton>
      {poses}
      {guides}
      {environment}
      {reference}
      <ViewButton title={t`Keyboard shortcuts (?)`} onClick={onShortcuts}>
        <Keyboard className="size-4" />
      </ViewButton>
    </ViewControls>
  );
}

interface ShowItem extends Toggle {
  id: string;
  name: string;
  /** The key that flips it, where it has one. */
  shortcut?: string;
}

/** The overlays that can be switched on and off, as one labelled menu. */
function ShowMenu({ items }: { items: ShowItem[] }) {
  const { t } = useLingui();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label={t`Show`}>
          <ListChecks className="size-4" />
          <Trans>Show</Trans>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {items.map((item) => (
          <DropdownMenuCheckboxItem
            key={item.id}
            checked={item.on}
            onCheckedChange={item.onChange}
          >
            {item.name}
            {item.shortcut ? (
              <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
