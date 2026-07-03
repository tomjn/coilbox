import { Button } from "@picoframe/frame";
import { Settings2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { ConfigOption } from "@/content/bindings";
import {
  ModOptionField,
  START_POS_OPTIONS,
} from "@/play/pages/components/GameOptionsPanel";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Battle } from "../bindings";
import {
  changedCount,
  displayedValue,
  type OptionScope,
  type PendingMap,
  rawOptionEntries,
  STARTPOSTYPE_KEY,
  scriptTagKey,
} from "./battleOptions";
import { useBattleOptions } from "./useBattleOptions";

/**
 * The battle-room options surface: an always-mounted trigger button plus a
 * right-hand slide-in drawer (radix `Dialog`, matching `MapPickerDrawer`) that
 * renders the game's mod options and the map's map options. The host/founder gets
 * editable controls; everyone else sees them read-only. When the schema is
 * unavailable (content not installed) but the host has set options, we show the
 * raw `key=value` pairs instead of pretending we can render them typed.
 */
export function BattleOptionsDrawer({
  battle,
  modOptionsSchema,
  mapOptionsSchema,
  canEdit,
  gameMissing,
  mapMissing,
  sendOption,
}: {
  battle: Battle;
  modOptionsSchema: ConfigOption[];
  mapOptionsSchema: ConfigOption[];
  canEdit: boolean;
  gameMissing: boolean;
  mapMissing: boolean;
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, setOption } = useBattleOptions(
    battle.scriptTags,
    sendOption,
  );

  const changed =
    changedCount(modOptionsSchema, battle.scriptTags, "mod") +
    changedCount(mapOptionsSchema, battle.scriptTags, "map");

  // startpostype isn't a scoped mod/map option — resolve it directly, preferring
  // an in-flight pending edit over the confirmed tag.
  const startPos =
    pending[STARTPOSTYPE_KEY.toLowerCase()]?.target ??
    battle.scriptTags[STARTPOSTYPE_KEY] ??
    "0";

  return (
    <>
      <div className="rounded-lg border border-border/50 bg-card">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/30"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="size-4 text-muted-foreground" />
            Battle options
          </span>
          <span className="text-xs text-muted-foreground">
            {changed > 0 ? `${changed} changed` : "defaults"}
          </span>
        </button>
      </div>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <DialogPrimitive.Title className="text-base font-semibold">
                Battle options
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  Read-only — only the host can change battle options.
                </p>
              )}

              <section>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Start positions
                </div>
                <OptionSelect
                  value={startPos}
                  disabled={!canEdit}
                  options={START_POS_OPTIONS}
                  onValueChange={(v) =>
                    setOption(STARTPOSTYPE_KEY, "startpostype", v)
                  }
                />
              </section>

              <OptionSection
                title="Mod options"
                scope="mod"
                schema={modOptionsSchema}
                missing={gameMissing}
                battle={battle}
                pending={pending}
                canEdit={canEdit}
                setOption={setOption}
              />
              <OptionSection
                title="Map options"
                scope="map"
                schema={mapOptionsSchema}
                missing={mapMissing}
                battle={battle}
                pending={pending}
                canEdit={canEdit}
                setOption={setOption}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/**
 * One scope's block: typed editors from the schema, or a raw read-only fallback
 * when the schema is unavailable (content not installed) but options are set.
 */
function OptionSection({
  title,
  scope,
  schema,
  missing,
  battle,
  pending,
  canEdit,
  setOption,
}: {
  title: string;
  scope: OptionScope;
  schema: ConfigOption[];
  missing: boolean;
  battle: Battle;
  pending: PendingMap;
  canEdit: boolean;
  setOption: (tagKey: string, spadsName: string, value: string) => void;
}) {
  const raw = rawOptionEntries(battle.scriptTags, scope);

  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>

      {schema.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3">
          {schema.map((o) => (
            <ModOptionField
              key={o.key}
              option={o}
              value={displayedValue(pending, battle.scriptTags, scope, o.key)}
              disabled={!canEdit}
              onChange={(v) => setOption(scriptTagKey(scope, o.key), o.key, v)}
            />
          ))}
        </div>
      ) : missing && raw.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Content not installed — showing raw values.
          </p>
          <ul className="space-y-1 text-sm">
            {raw.map((e) => (
              <li key={e.key} className="flex justify-between gap-3">
                <span className="truncate text-muted-foreground">{e.key}</span>
                <span className="font-mono">{e.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No options.</p>
      )}
    </section>
  );
}
