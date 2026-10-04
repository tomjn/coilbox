import { Button, Input } from "@picoframe/frame";
import { BellPlus } from "lucide-react";
import { useState } from "react";
import { CheckField, Field } from "@/components/Field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { notify } from "../../notify/notify";
import {
  describeSearch,
  type SavedBattleSearch,
  useSavedBattleSearches,
} from "./savedSearch";

const EMPTY = {
  game: "",
  map: "",
  minPlayers: "",
  freeSlot: true,
  noPassword: true,
};

/**
 * Saves a search that coilbox watches for while connected, on every server, and
 * raises a notification when a battle starts matching it. The searches are
 * switched off and removed in Settings, Notifications.
 */
export function SaveSearchPopover() {
  const { update } = useSavedBattleSearches();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const game = form.game.trim();
  const minPlayers = Number(form.minPlayers);
  const minValid =
    form.minPlayers === "" || (Number.isInteger(minPlayers) && minPlayers >= 0);

  const save = () => {
    if (!game || !minValid) return;
    const search: SavedBattleSearch = {
      id: crypto.randomUUID(),
      game,
      map: form.map.trim(),
      minPlayers: form.minPlayers === "" ? 0 : minPlayers,
      freeSlot: form.freeSlot,
      noPassword: form.noPassword,
      enabled: true,
    };
    update((cur) => [...cur, search]);
    void notify({
      title: "Search saved",
      body: `Coilbox will tell you when a battle matches ${describeSearch(search)}.`,
      level: "success",
    });
    setForm(EMPTY);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          className="h-9 shrink-0 gap-2 px-3"
          aria-label="Tell me when a battle matches"
        >
          <BellPlus className="size-4" />
          Alert me
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-xs text-muted-foreground">
          Coilbox tells you once when a battle matching this appears on any
          server you are connected to.
        </p>
        <Field label="Game" hint="Part of the game's name.">
          <Input
            value={form.game}
            onChange={(e) => setForm((f) => ({ ...f, game: e.target.value }))}
            placeholder="Beyond All Reason"
          />
        </Field>
        <Field label="Map (optional)" hint="Part of the map's name.">
          <Input
            value={form.map}
            onChange={(e) => setForm((f) => ({ ...f, map: e.target.value }))}
          />
        </Field>
        <Field label="Players at least (optional)">
          <Input
            type="number"
            min={0}
            value={form.minPlayers}
            onChange={(e) =>
              setForm((f) => ({ ...f, minPlayers: e.target.value }))
            }
          />
        </Field>
        <CheckField
          label="Has a free slot"
          checked={form.freeSlot}
          onChange={(v) => setForm((f) => ({ ...f, freeSlot: v }))}
        />
        <CheckField
          label="No password"
          checked={form.noPassword}
          onChange={(v) => setForm((f) => ({ ...f, noPassword: v }))}
        />
        <Button className="w-full" disabled={!game || !minValid} onClick={save}>
          Save search
        </Button>
      </PopoverContent>
    </Popover>
  );
}
