/**
 * The project's weapon library (issue #2640): weapons copied out of the game
 * under names of their own, edited here, and equipped into any unit's slot on
 * that unit's Weapons tab.
 *
 * The project's Weapons section (issue #3111), a page of its own. It was a
 * drawer over the unit editor, which left the field list a 48rem column. On
 * a page the game's weapons and the library sit on the left and the weapon
 * being edited takes the rest. Adding comes first because an empty library is
 * where everybody starts. The field list is the same one the Weapons tab
 * draws, so a weapon is edited here exactly as it is in a slot.
 */
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
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

export function WeaponLibraryPanel({
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
  const { t } = useLingui();
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
  const copiedFrom = selected?.source;
  const fields = selected
    ? libraryWeaponGroup(
        selected,
        view,
        mounts.length === 0
          ? t`Copied from ${copiedFrom}. No slot fires it yet, so it is not in the game. Equip it from a unit's Weapons tab.`
          : t`Copied from ${copiedFrom}. A change here reaches every slot that fires it, and no other unit.`,
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

  const weaponCount = keys.length;
  const moreCount = matches.length - SHOWN;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="flex flex-col gap-6">
        <p className="text-sm text-muted-foreground">
          <Trans>
            Weapons this project owns. Copy one out of {gameName}, change it
            here, then equip it into any unit's slot on that unit's Weapons tab.
          </Trans>
        </p>
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            <Trans>Add a weapon from {gameName}</Trans>
          </h3>
          <Field
            label={t`Find a weapon`}
            hint={plural(weaponCount, {
              one: "# weapon definition in the game.",
              other: "# weapon definitions in the game.",
            })}
          >
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t`Name or key`}
              className="h-8"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <ul
            className="flex max-h-56 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1"
            aria-label={t`Weapons in the game`}
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
                <Trans>No weapon in {gameName} matches that.</Trans>
              </li>
            )}
            {matches.length > SHOWN && (
              <li className="p-2 text-xs text-muted-foreground">
                <Trans>
                  {moreCount} more. Type more of a name to find them.
                </Trans>
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
                label={t`Name for the copy of ${source}`}
                className="min-w-64 flex-1"
                hint={
                  check.ok
                    ? t`Lowercase letters, numbers and underscores.`
                    : check.verdict === "empty"
                      ? t`Give the copy a name.`
                      : check.verdict === "invalid"
                        ? t`A weapon name can only use lowercase letters, numbers and underscores.`
                        : t`The library already has a weapon called ${check.key}.`
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
                <Trans>Add to library</Trans>
              </Button>
            </form>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            <Trans>In this project</Trans>{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {weapons.length}
            </span>
          </h3>
          {weapons.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans>
                Nothing yet. A weapon added above, or copied from a unit's slot,
                is listed here.
              </Trans>
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
              aria-label={t`Library weapon`}
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
                        title={plural(changed, {
                          one: "# field changed",
                          other: "# fields changed",
                        })}
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
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        {selected && fields && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <h3 className="font-mono text-sm font-medium">
                  {selected.key}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {mounts.length === 0
                    ? t`Not equipped anywhere.`
                    : plural(mounts.length, {
                        one: "Equipped in # place:",
                        other: "Equipped in # places:",
                      })}
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
                  aria-label={t`Which weapon fields to show`}
                >
                  <ToggleGroupItem value="relevant">
                    <Trans>Relevant</Trans>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="all">
                    <Trans>All</Trans>
                  </ToggleGroupItem>
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
              inheritedLabel={t`Copied value`}
              post={postOf && ((row) => postOf(selected.key, row))}
              onChange={(row, value) => onChange(selected.key, row, value)}
              onReset={(row) => onReset(selected.key, row)}
            />
          </section>
        )}
      </div>
    </div>
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
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="size-3.5" />
          <Trans>Delete</Trans>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">
            <Trans>Delete {name}?</Trans>
          </h3>
          <p className="text-xs text-muted-foreground">
            {mounts > 0
              ? plural(mounts, {
                  one: "It goes out of the library, and the # slot that fires it goes back to the game's own weapon. Undo puts it back.",
                  other:
                    "It goes out of the library, and the # slots that fire it go back to the game's own weapon. Undo puts it back.",
                })
              : t`It goes out of the library. Undo puts it back.`}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(false)}
          >
            <Trans>Cancel</Trans>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            <Trans>Delete</Trans>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
