/**
 * The project's weapon library (issue #2640): weapons copied out of the game
 * under names of their own, edited here, and equipped into any unit's slot on
 * that unit's Weapons tab.
 *
 * A drawer rather than a page, so the unit being worked on stays where it was.
 * Adding comes first because an empty library is where everybody starts. The
 * field list is the same one the Weapons tab draws, so a weapon is edited here
 * exactly as it is in a slot.
 */
import { Button, Drawer, Input } from "@picoframe/frame";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Field } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CustomParamsResult } from "@/content/bindings";
import type { PostNote } from "../../beforePost";
import type { FieldRow, FieldView } from "../../unitSections";
import {
  checkWeaponName,
  type EquippedWeapons,
  libraryChangeCount,
  mountsOf,
  suggestWeaponKey,
  type WeaponLibrary,
  type WeaponMount,
} from "../../weaponLibrary";
import { libraryWeaponGroup } from "../../weaponSlots";
import { UnitFieldGroups } from "./UnitFieldGroups";

/** How many of the game's weapons the picker lists before asking for more
 *  of a name. Only a limit on what is drawn: the search covers them all. */
const SHOWN = 60;

/** What a game weapon is called on screen, beside its key. */
function displayName(def: Record<string, unknown>): string | undefined {
  const key = Object.keys(def).find((k) => k.toLowerCase() === "name");
  const value = key === undefined ? undefined : def[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function WeaponLibraryDrawer({
  open,
  onOpenChange,
  gameName,
  gameWeapons,
  library,
  equipped,
  consumers,
  describeMount,
  onAdd,
  onDelete,
  onChange,
  onReset,
  postOf,
  onOpenMount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gameName: string;
  /** The game's own weapon table, keyed by lowercased name. */
  gameWeapons: Record<string, Record<string, unknown>>;
  library: WeaponLibrary;
  equipped: EquippedWeapons;
  consumers: CustomParamsResult | null;
  /** A slot that fires a weapon, in words: the unit's name and the slot. */
  describeMount: (mount: WeaponMount) => string;
  onAdd: (key: string, source: string) => void;
  onDelete: (key: string) => void;
  onChange: (key: string, row: FieldRow, value: unknown) => void;
  onReset: (key: string, row: FieldRow) => void;
  /** What the game's post files do to a weapon's field (issue #3057). */
  postOf?: (key: string, row: FieldRow) => PostNote | undefined;
  onOpenMount: (mount: WeaponMount) => void;
}) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string | undefined>();
  const [view, setView] = useState<FieldView>("relevant");

  const keys = useMemo(() => Object.keys(gameWeapons).sort(), [gameWeapons]);
  const needle = search.trim().toLowerCase();
  const matches = useMemo(
    () =>
      needle
        ? keys.filter(
            (key) =>
              key.includes(needle) ||
              displayName(gameWeapons[key])?.toLowerCase().includes(needle),
          )
        : keys,
    [keys, needle, gameWeapons],
  );

  const check = checkWeaponName(name, library);
  const weapons = Object.values(library).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const selected =
    (picked !== undefined ? library[picked] : undefined) ?? weapons[0];
  const mounts = selected ? mountsOf(equipped, selected.key) : [];
  const fields = selected
    ? libraryWeaponGroup(
        selected,
        view,
        `Copied from ${selected.source}. ${
          mounts.length === 0
            ? "No slot fires it yet, so it is not in the game. Equip it from a unit's Weapons tab."
            : `A change here reaches every slot that fires it, and no other unit.`
        }`,
      )
    : undefined;

  const choose = (key: string) => {
    setSource(key);
    setName(suggestWeaponKey(key, library));
  };
  const add = () => {
    if (!source || !check.ok) return;
    onAdd(check.key, source);
    setPicked(check.key);
    setSource(undefined);
    setSearch("");
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Weapon library"
      description={`Weapons this project owns. Copy one out of ${gameName}, change it here, then equip it into any unit's slot on that unit's Weapons tab.`}
      width="48rem"
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">Add a weapon from {gameName}</h3>
          <Field
            label="Find a weapon"
            hint={`${keys.length} weapon definitions in the game.`}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or key"
              className="h-8"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <ul
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1"
            aria-label="Weapons in the game"
          >
            {matches.slice(0, SHOWN).map((key) => (
              <li key={key}>
                <Button
                  type="button"
                  variant={key === source ? "secondary" : "ghost"}
                  size="sm"
                  className="h-auto w-full justify-between gap-3 py-1 text-left"
                  aria-pressed={key === source}
                  onClick={() => choose(key)}
                >
                  <span className="truncate font-mono text-xs">{key}</span>
                  <span className="truncate text-xs font-normal text-muted-foreground">
                    {displayName(gameWeapons[key])}
                  </span>
                </Button>
              </li>
            ))}
            {matches.length === 0 && (
              <li className="p-2 text-xs text-muted-foreground">
                No weapon in {gameName} matches that.
              </li>
            )}
            {matches.length > SHOWN && (
              <li className="p-2 text-xs text-muted-foreground">
                {matches.length - SHOWN} more. Type more of a name to find them.
              </li>
            )}
          </ul>
          {source && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <Field
                label={`Name for the copy of ${source}`}
                className="min-w-64 flex-1"
                hint={
                  check.ok
                    ? "Lowercase letters, numbers and underscores."
                    : check.verdict === "empty"
                      ? "Give the copy a name."
                      : check.verdict === "invalid"
                        ? "A weapon name can only use lowercase letters, numbers and underscores."
                        : `The library already has a weapon called ${check.key}.`
                }
              >
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase())}
                  className="h-8 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Button type="submit" size="sm" disabled={!check.ok}>
                <Plus className="size-3.5" />
                Add to library
              </Button>
            </form>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            In this project{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {weapons.length}
            </span>
          </h3>
          {weapons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. A weapon added above, or copied from a unit's slot,
              is listed here.
            </p>
          ) : (
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              className="flex-wrap"
              value={selected?.key ?? ""}
              onValueChange={(key) => key && setPicked(key)}
              aria-label="Library weapon"
            >
              {weapons.map((weapon) => {
                const changed = libraryChangeCount(weapon);
                return (
                  <ToggleGroupItem
                    key={weapon.key}
                    value={weapon.key}
                    className="gap-1.5 font-mono text-xs"
                  >
                    {weapon.key}
                    {changed > 0 && (
                      <span
                        className="rounded-full bg-primary px-1.5 font-sans text-[10px] text-primary-foreground"
                        title={`${changed} field${changed === 1 ? "" : "s"} changed`}
                      >
                        {changed}
                      </span>
                    )}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}
        </section>

        {selected && fields && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <h3 className="font-mono text-sm font-medium">
                  {selected.key}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {mounts.length === 0
                    ? "Not equipped anywhere."
                    : `Fired by ${mounts.length} slot${mounts.length === 1 ? "" : "s"}:`}
                </p>
                {mounts.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {mounts.map((mount) => (
                      <li key={`${mount.unit}:${mount.step}`}>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => onOpenMount(mount)}
                        >
                          {describeMount(mount)}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={view}
                  onValueChange={(v) => v && setView(v as FieldView)}
                  aria-label="Which weapon fields to show"
                >
                  <ToggleGroupItem value="relevant">Relevant</ToggleGroupItem>
                  <ToggleGroupItem value="all">All</ToggleGroupItem>
                </ToggleGroup>
                <DeleteWeaponButton
                  name={selected.key}
                  mounts={mounts.length}
                  onDelete={() => {
                    onDelete(selected.key);
                    setPicked(undefined);
                  }}
                />
              </div>
            </div>
            <UnitFieldGroups
              view={{
                groups: [fields.group],
                shown: view === "all" ? fields.all : fields.relevant,
                hidden: fields.all - fields.relevant,
              }}
              consumers={consumers}
              inheritedLabel="Copied value"
              post={postOf && ((row) => postOf(selected.key, row))}
              onChange={(row, value) => onChange(selected.key, row, value)}
              onReset={(row) => onReset(selected.key, row)}
            />
          </section>
        )}
      </div>
    </Drawer>
  );
}

/** Take a weapon out of the library, and out of every slot that fires it. */
function DeleteWeaponButton({
  name,
  mounts,
  onDelete,
}: {
  name: string;
  mounts: number;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">Delete {name}?</h3>
          <p className="text-xs text-muted-foreground">
            It goes out of the library
            {mounts > 0
              ? `, and the ${mounts} slot${mounts === 1 ? "" : "s"} that fire it go back to the game's own weapon`
              : ""}
            . Undo puts it back.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
