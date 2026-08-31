import { Button } from "@picoframe/frame";
import { Settings2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { UnitRestrictions } from "@/campaign/pages/components/UnitRestrictions";
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
import { disabledFromTags } from "./restrictTags";
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
  canEditRestrictions,
  restrictionsUnavailable,
  startPositionsUnavailable,
  onRestrictChange,
}: {
  battle: Battle;
  modOptionsSchema: ConfigOption[];
  mapOptionsSchema: ConfigOption[];
  canEdit: boolean;
  gameMissing: boolean;
  mapMissing: boolean;
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
  /** Whether the local user may edit unit restrictions (founder only). */
  canEditRestrictions: boolean;
  /**
   * Why this connection carries no unit restrictions, or null where it does
   * (issue #1979). Said in the section it belongs to, because "No restrictions"
   * would be a claim about this room rather than about the protocol.
   */
  restrictionsUnavailable?: string | null;
  /** The same for the start position mode, in the section above it. */
  startPositionsUnavailable?: string | null;
  /** Apply the full disabled-unit set (writes `game/restrict/*` script tags). */
  onRestrictChange: (disabled: string[]) => void;
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
                {startPositionsUnavailable ? (
                  <p className="text-xs text-muted-foreground">
                    {startPositionsUnavailable}
                  </p>
                ) : (
                  <OptionSelect
                    value={startPos}
                    disabled={!canEdit}
                    options={START_POS_OPTIONS}
                    onValueChange={(v) =>
                      setOption(STARTPOSTYPE_KEY, "startpostype", v)
                    }
                  />
                )}
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
              <RestrictSection
                gameName={battle.modname}
                scriptTags={battle.scriptTags}
                canEdit={canEditRestrictions}
                unavailable={restrictionsUnavailable}
                onChange={onRestrictChange}
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
              // A field reports `undefined` when the host clears an option they
              // had set. Writing the game's own default is the right answer, not
              // a compromise: a battle we host carries a tag for every option
              // the game declares (#1837), so withdrawing one would hand that
              // option back to the engine's built-in value rather than to the
              // game's.
              onChange={(v) =>
                setOption(
                  scriptTagKey(scope, o.key),
                  o.key,
                  v ?? o.default ?? "",
                )
              }
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

/** Order-independent equality of two unit-name sets. */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Unit-restriction editor block. The founder gets the shared `UnitRestrictions`
 * editor; everyone else sees the current disabled set read-only. Edits are
 * optimistic: we hold a local set until the founder's `game/restrict/*` write
 * echoes back into `scriptTags`, so rapid toggles don't race the round-trip (the
 * editor reports the whole next set each change, so a stale base would clobber).
 */
function RestrictSection({
  gameName,
  scriptTags,
  canEdit,
  unavailable,
  onChange,
}: {
  gameName: string;
  scriptTags: Record<string, string>;
  canEdit: boolean;
  /** Why the protocol carries none, or null where it does (issue #1979). */
  unavailable?: string | null;
  onChange: (disabled: string[]) => void;
}) {
  const confirmed = useMemo(() => disabledFromTags(scriptTags), [scriptTags]);
  // Optimistic override, cleared once the server confirms it matches.
  const [local, setLocal] = useState<string[] | null>(null);
  useEffect(() => {
    if (local && sameSet(local, confirmed)) setLocal(null);
  }, [local, confirmed]);
  const disabled = local ?? confirmed;

  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        Unit restrictions
      </div>
      {unavailable ? (
        <p className="text-xs text-muted-foreground">{unavailable}</p>
      ) : canEdit ? (
        <UnitRestrictions
          gameName={gameName}
          disabledUnits={disabled}
          onChange={(next) => {
            setLocal(next);
            onChange(next);
          }}
        />
      ) : disabled.length === 0 ? (
        <p className="text-xs text-muted-foreground">No restrictions.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {disabled.map((name) => (
            <li key={name} className="font-mono text-muted-foreground">
              {name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
