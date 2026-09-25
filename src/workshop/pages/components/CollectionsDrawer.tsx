/**
 * The project's collections (issue #2654): named, nestable sets of units that
 * scope the unit list and, later, batch edits (#2655) and an export (#2656's
 * neighbour, restricting a package to one collection's units).
 *
 * A drawer rather than a page, matching `WeaponLibraryDrawer`: the unit being
 * worked on stays where it was. Creating a collection comes first, the tree
 * of what exists is next, and picking one opens a searchable checklist of
 * every unit in the game to add or remove from it.
 */
import { Button, Drawer, Input } from "@picoframe/frame";
import { FolderPlus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type Collection,
  type Collections,
  collectionTree,
  collectionUnits,
} from "../../collections";

/** How many units the membership checklist draws before asking for more of a
 *  search term. Only a limit on what is drawn: a game the size of Beyond All
 *  Reason (1,789 units) rendered whole would cost real layout time on every
 *  open, and the search covers every unit regardless. */
const SHOWN = 200;

/** A parent picker's options: no parent, then every collection except `id`
 *  itself and its own descendants, which {@link setCollectionParent} would
 *  refuse anyway and offering them here would only be a click that does
 *  nothing. */
function parentOptions(collections: Collections, excludeId?: string) {
  const blocked = new Set<string>();
  if (excludeId) {
    // Mirrors the cycle guard: a collection cannot nest under itself or under
    // one of its own descendants.
    const stack = [excludeId];
    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || blocked.has(id)) continue;
      blocked.add(id);
      for (const c of Object.values(collections))
        if (c.parentId === id) stack.push(c.id);
    }
  }
  return [
    { value: "", label: "No parent (top level)" },
    ...collectionTree(collections)
      .filter((n) => !blocked.has(n.collection.id))
      .map((n) => ({
        value: n.collection.id,
        label: `${"— ".repeat(n.depth)}${n.collection.name}`,
      })),
  ];
}

export function CollectionsDrawer({
  open,
  onOpenChange,
  collections,
  units,
  nameOf,
  onCreate,
  onRename,
  onDelete,
  onSetParent,
  onToggleMember,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: Collections;
  /** The game's units with the project's own already in among them, the same
   *  set `UnitList` draws from. */
  units: Record<string, Record<string, unknown>>;
  nameOf: (key: string, def: Record<string, unknown>) => string;
  onCreate: (name: string, parentId: string | undefined) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSetParent: (id: string, parentId: string | undefined) => void;
  onToggleMember: (id: string, unit: string, member: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [search, setSearch] = useState("");

  const tree = useMemo(() => collectionTree(collections), [collections]);
  const active = selected ? collections[selected] : undefined;
  const activeUnits = active
    ? collectionUnits(collections, active.id)
    : undefined;

  const allUnits = useMemo(
    () =>
      Object.entries(units)
        .map(([key, def]) => ({ key, label: nameOf(key, def) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [units, nameOf],
  );
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? allUnits.filter(
        (u) => u.key.includes(needle) || u.label.toLowerCase().includes(needle),
      )
    : allUnits;

  const create = () => {
    if (!name.trim()) return;
    onCreate(name, newParent || undefined);
    setName("");
    setNewParent("");
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Collections"
      description="Named, nestable sets of units. A parent includes everything its children hold."
      width="32rem"
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">New collection</h3>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <Field label="Name">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tier two"
                className="h-8"
              />
            </Field>
            {tree.length > 0 && (
              <Field label="Nest under">
                <OptionSelect
                  value={newParent}
                  onValueChange={setNewParent}
                  options={parentOptions(collections)}
                  size="sm"
                  ariaLabel="Nest the new collection under"
                />
              </Field>
            )}
            <Button type="submit" size="sm" disabled={!name.trim()}>
              <FolderPlus className="size-3.5" />
              Create
            </Button>
          </form>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium">
            In this project{" "}
            <span className="text-xs font-normal text-muted-foreground">
              {Object.keys(collections).length}
            </span>
          </h3>
          {tree.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet. Create one above.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tree.map(({ collection, depth }) => (
                <CollectionRow
                  key={collection.id}
                  collection={collection}
                  depth={depth}
                  memberCount={
                    collectionUnits(collections, collection.id)?.size ?? 0
                  }
                  isSelected={collection.id === selected}
                  parentOptions={parentOptions(collections, collection.id)}
                  onSelect={() => setSelected(collection.id)}
                  onRename={(next) => onRename(collection.id, next)}
                  onSetParent={(parentId) =>
                    onSetParent(collection.id, parentId)
                  }
                  onDelete={() => {
                    onDelete(collection.id);
                    if (selected === collection.id) setSelected(undefined);
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        {active && (
          <section className="flex flex-col gap-3 border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium">
              Units in {active.name}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {activeUnits?.size ?? 0}
              </span>
            </h3>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find a unit"
              className="h-8"
              autoComplete="off"
              spellCheck={false}
            />
            <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto rounded-md border border-border/60 p-1">
              {matches.slice(0, SHOWN).map((u) => {
                // Own membership, not what nesting resolves to: a unit picked
                // up from a child shows as included above but is not a
                // checkbox this collection owns, so ticking it here would add
                // a second, redundant listing rather than move anything.
                const checked = active.units.includes(u.key);
                return (
                  // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Checkbox> control
                  <label
                    key={u.key}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        onToggleMember(active.id, u.key, v === true)
                      }
                    />
                    <span className="min-w-0 flex-1 truncate">{u.label}</span>
                    <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                      {u.key}
                    </span>
                  </label>
                );
              })}
              {matches.length === 0 && (
                <li className="p-2 text-xs text-muted-foreground">
                  No unit matches that.
                </li>
              )}
              {matches.length > SHOWN && (
                <li className="p-2 text-xs text-muted-foreground">
                  {matches.length - SHOWN} more. Type more of a name to find
                  them.
                </li>
              )}
            </ul>
          </section>
        )}
      </div>
    </Drawer>
  );
}

/** One row in the collection tree: its name (editable in place), how many
 *  units it resolves to including its children, a parent picker, and delete. */
function CollectionRow({
  collection,
  depth,
  memberCount,
  isSelected,
  parentOptions,
  onSelect,
  onRename,
  onSetParent,
  onDelete,
}: {
  collection: Collection;
  depth: number;
  memberCount: number;
  isSelected: boolean;
  parentOptions: { value: string; label: string }[];
  onSelect: () => void;
  onRename: (name: string) => void;
  onSetParent: (parentId: string | undefined) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(collection.name);

  return (
    <li
      className="flex flex-wrap items-center gap-2 rounded-md p-1.5"
      style={{ paddingLeft: `${depth * 1.25 + 0.375}rem` }}
    >
      {editing ? (
        <form
          className="flex flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            onRename(draft);
            setEditing(false);
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(draft);
              setEditing(false);
            }}
            className="h-7"
          />
        </form>
      ) : (
        <Button
          type="button"
          variant={isSelected ? "secondary" : "ghost"}
          size="sm"
          className="h-7 min-w-0 flex-1 justify-start gap-1.5 truncate"
          onClick={onSelect}
          onDoubleClick={() => {
            setDraft(collection.name);
            setEditing(true);
          }}
          aria-pressed={isSelected}
          title="Click to edit its units, double click to rename"
        >
          <span className="truncate">{collection.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {memberCount}
          </span>
        </Button>
      )}
      <div className="w-40 shrink-0">
        <OptionSelect
          value={collection.parentId ?? ""}
          onValueChange={(v) => onSetParent(v || undefined)}
          options={parentOptions}
          size="sm"
          ariaLabel={`Nest ${collection.name} under`}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 px-2"
        onClick={onDelete}
        aria-label={`Delete ${collection.name}`}
        title="Delete this collection. Its children move up to its own parent."
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}
