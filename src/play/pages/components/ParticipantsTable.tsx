import { Button } from "@picoframe/frame";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Side, SkirmishAi } from "@/content/bindings";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { hexToRgb, type Participant, rgbToHex } from "../../config";

/** Ally-team letters (A, B, C…) mapped to indices, offered per row. */
const allyLetter = (n: number) => String.fromCharCode(65 + n);

/** Encode/decode an AI select value as `kind:shortName`. */
const aiValue = (a: { kind: string; shortName: string }) =>
  `${a.kind}:${a.shortName}`;

export function ParticipantsTable({
  participants,
  sides,
  ais,
  disabled,
  onUpdate,
  onRemove,
  onAddAi,
}: {
  participants: Participant[];
  sides: Side[];
  ais: SkirmishAi[];
  disabled?: boolean;
  onUpdate: (id: string, patch: Partial<Participant>) => void;
  onRemove: (id: string) => void;
  onAddAi: () => void;
}) {
  // Team index (0-based) per non-spectator participant, in row order.
  const teamByI: (number | null)[] = [];
  let team = 0;
  for (const p of participants) {
    const isSpec = p.kind === "you" && p.spectator;
    teamByI.push(isSpec ? null : team++);
  }

  const sideOptions = sides.map((s) => ({ value: s.name, label: s.name }));
  // Offer allies up to the participant count so any FFA/teams split is reachable.
  const allyOptions = participants.map((_, i) => ({
    value: String(i),
    label: `Ally ${allyLetter(i)}`,
  }));
  const nativeAis = ais.filter((a) => a.kind === "native");
  const luaAis = ais.filter((a) => a.kind === "lua");

  return (
    <div className="rounded-lg border border-border/50 bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-3 pb-2 pt-3 text-left font-medium">Player</th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Faction</th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Team</th>
              <th className="px-3 pb-2 pt-3 text-left font-medium">Ally</th>
              <th className="px-3 pb-2 pt-3" />
            </tr>
          </thead>
          <tbody>
            {participants.map((p, i) => (
              <tr key={p.id} className="border-t border-border/40">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="color"
                      aria-label={`${p.name} colour`}
                      value={rgbToHex(p.color)}
                      disabled={disabled}
                      onChange={(e) =>
                        onUpdate(p.id, { color: hexToRgb(e.target.value) })
                      }
                      className="color-swatch size-6 shrink-0 cursor-pointer rounded border border-white/25 bg-transparent p-0 disabled:cursor-not-allowed"
                    />
                    {p.kind === "you" ? (
                      <div className="leading-tight">
                        <div>You</div>
                        <div className="text-[11px] text-muted-foreground">
                          Human · host
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 leading-tight">
                        <Select
                          value={p.ai ? aiValue(p.ai) : ""}
                          disabled={disabled}
                          onValueChange={(v) => {
                            const [kind, shortName] = v.split(/:(.*)/s);
                            const found = ais.find(
                              (a) =>
                                a.kind === kind && a.shortName === shortName,
                            );
                            onUpdate(p.id, {
                              ai: {
                                kind: kind as "native" | "lua",
                                shortName,
                                name: found?.name,
                              },
                            });
                          }}
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-44"
                            aria-invalid={!p.ai}
                          >
                            <SelectValue placeholder="Pick an AI" />
                          </SelectTrigger>
                          <SelectContent>
                            {nativeAis.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Engine AIs</SelectLabel>
                                {nativeAis.map((a) => (
                                  <SelectItem
                                    key={aiValue(a)}
                                    value={aiValue(a)}
                                  >
                                    {a.name ?? a.shortName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {luaAis.length > 0 && (
                              <SelectGroup>
                                <SelectLabel>Game AIs (Lua)</SelectLabel>
                                {luaAis.map((a) => (
                                  <SelectItem
                                    key={aiValue(a)}
                                    value={aiValue(a)}
                                  >
                                    {a.name ?? a.shortName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            {ais.length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                No AIs found
                              </div>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </td>

                <td className="px-3 py-2">
                  {p.kind === "you" && p.spectator ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <OptionSelect
                      value={p.side}
                      size="sm"
                      className="w-auto min-w-20"
                      disabled={disabled || sideOptions.length === 0}
                      options={sideOptions}
                      onValueChange={(v) => onUpdate(p.id, { side: v })}
                    />
                  )}
                </td>

                <td className="px-3 py-2">
                  <span className="inline-flex h-8 min-w-8 items-center justify-center rounded border border-border/60 bg-muted/40 px-2 text-xs">
                    {teamByI[i] === null ? "–" : (teamByI[i] as number) + 1}
                  </span>
                </td>

                <td className="px-3 py-2">
                  {p.kind === "you" && p.spectator ? (
                    <span className="text-xs text-muted-foreground">–</span>
                  ) : (
                    <OptionSelect
                      value={String(p.allyTeam)}
                      size="sm"
                      className="w-24"
                      disabled={disabled}
                      options={allyOptions}
                      onValueChange={(v) =>
                        onUpdate(p.id, { allyTeam: Number(v) })
                      }
                    />
                  )}
                </td>

                <td className="px-3 py-2 text-right">
                  {p.kind === "you" ? null : (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${p.name}`}
                      disabled={disabled}
                      onClick={() => onRemove(p.id)}
                    >
                      <X className="size-4" />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-border/40 p-3">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onAddAi}>
          + Add AI opponent
        </Button>
      </div>
    </div>
  );
}
