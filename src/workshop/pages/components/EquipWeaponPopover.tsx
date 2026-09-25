/**
 * Choosing which weapon a slot fires, out of the project's weapon library
 * (issue #2640), or giving the unit its own copy of the one it fires now
 * (issue #3052).
 *
 * A popover rather than a dialog, so the slot it acts on stays on screen.
 * Copying comes first because it is the answer for a slot whose weapon is
 * shared: the copy goes into the library under a name of its own and this
 * slot fires it, and nothing else in the game changes.
 */
import { Button, Input } from "@picoframe/frame";
import { Copy, Crosshair } from "lucide-react";
import { useState } from "react";
import { Field } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  checkWeaponName,
  suggestWeaponKey,
  type WeaponLibrary,
} from "../../weaponLibrary";

export function EquipWeaponPopover({
  label,
  shared,
  unitName,
  slotNumber,
  copySource,
  library,
  equippedHere,
  mounts,
  refusal,
  onCopy,
  onEquip,
}: {
  /** What the button says. */
  label: string;
  /** Whether the slot's weapon is out of the game's shared table, which is
   *  when the copy is the thing to do and the button says so. */
  shared: boolean;
  unitName: string;
  slotNumber: number;
  /** The weapon the slot fires now, as the game names it, when there is one
   *  to copy. */
  copySource: string | undefined;
  library: WeaponLibrary;
  /** The library weapon this slot already fires, if any. */
  equippedHere: string | undefined;
  /** How many slots fire each library weapon. */
  mounts: (key: string) => number;
  /** Why this unit cannot fire a weapon of that name, if it cannot. */
  refusal: (key: string) => string | undefined;
  onCopy: (key: string) => void;
  onEquip: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const toggle = (next: boolean) => {
    setOpen(next);
    if (next && copySource) setName(suggestWeaponKey(copySource, library));
  };

  const check = checkWeaponName(name, library);
  const blocked = check.ok ? refusal(check.key) : undefined;
  const choices = Object.values(library)
    .filter((weapon) => weapon.key !== equippedHere)
    .sort((a, b) => a.key.localeCompare(b.key));

  return (
    <Popover open={open} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button variant={shared ? "default" : "outline"} size="sm">
          {shared ? (
            <Copy className="size-3.5" />
          ) : (
            <Crosshair className="size-3.5" />
          )}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-96 flex-col gap-4">
        {copySource && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!check.ok || blocked) return;
              onCopy(check.key);
              setOpen(false);
            }}
          >
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-medium">
                {shared
                  ? `Give ${unitName} its own copy`
                  : "Copy this weapon into the library"}
              </h3>
              <p className="text-xs text-muted-foreground">
                Copies <span className="font-mono">{copySource}</span> as it
                stands into the project's weapon library, and weapon{" "}
                {slotNumber} fires the copy. Changing the copy changes no other
                unit.
              </p>
            </div>
            <Field
              label="Weapon name"
              hint="Lowercase letters, numbers and underscores."
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                className="h-8 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            {!check.ok && (
              <p className="text-xs text-muted-foreground">
                {check.verdict === "empty"
                  ? "Give the copy a name."
                  : check.verdict === "invalid"
                    ? "A weapon name can only use lowercase letters, numbers and underscores."
                    : `The library already has a weapon called ${check.key}. Equip that one below, or pick another name.`}
              </p>
            )}
            {blocked && <p className="text-xs text-destructive">{blocked}</p>}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!check.ok || !!blocked}>
                Copy and equip
              </Button>
            </div>
          </form>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {copySource
              ? "Or equip one from the library"
              : "Equip one from the library"}
          </h3>
          {choices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {Object.keys(library).length === 0
                ? "The project's weapon library is empty. Add weapons from the Weapons button at the top of the page."
                : "The library holds no other weapon."}
            </p>
          ) : (
            <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
              {choices.map((weapon) => {
                const why = refusal(weapon.key);
                const fired = mounts(weapon.key);
                return (
                  <li key={weapon.key}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto w-full flex-col items-start gap-0.5 py-1.5 text-left"
                      disabled={!!why}
                      title={why}
                      onClick={() => {
                        onEquip(weapon.key);
                        setOpen(false);
                      }}
                    >
                      <span className="font-mono text-xs">{weapon.key}</span>
                      <span className="text-xs font-normal text-muted-foreground">
                        {why ??
                          `Copied from ${weapon.source}${fired > 0 ? `, fired by ${fired} slot${fired === 1 ? "" : "s"}` : ""}`}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </PopoverContent>
    </Popover>
  );
}
