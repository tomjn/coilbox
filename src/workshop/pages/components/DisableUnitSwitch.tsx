/**
 * The switch that takes a unit out of the game (issue #2649).
 *
 * A switch rather than a delete button, because that is what it is: the
 * definition stays exactly where it was and the mark can come off again. The
 * wording is "Disabled" and never "Remove", so it does not read as the other
 * thing on this page that removes something, which is taking a unit off one
 * builder's menu.
 *
 * Nothing here is guarded by the mark. A disabled unit can still be edited,
 * copied and put on a build menu, because the mark is reversible and blocking
 * those would only make the user switch the unit on, do the work, and switch it
 * off again. Disabling a game unit to ship your own copy in its place is a
 * normal thing to do, and it needs both halves to be possible at once.
 */
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function DisableUnitSwitch({
  unitKey,
  unitName,
  disabled,
  onChange,
}: {
  /** The unit the switch is for, which keeps the control's id unique. */
  unitKey: string;
  unitName: string;
  disabled: boolean;
  onChange: (disabled: boolean) => void;
}) {
  const id = `workshop-disable-${unitKey}`;
  return (
    <span className="flex items-center gap-2">
      <Switch
        id={id}
        checked={disabled}
        onCheckedChange={onChange}
        aria-label={`Disable ${unitName}`}
      />
      <Label htmlFor={id} className="text-xs font-medium">
        Disabled
      </Label>
    </span>
  );
}
