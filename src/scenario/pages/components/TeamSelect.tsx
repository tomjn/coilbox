/**
 * Whose a placed thing is: one of the setup's participants.
 *
 * Picked by the colour its units are drawn in as much as by the name, because a
 * skirmish setup names most of its participants "AI 1" and the colour is what is
 * on the map. Shared by the mode strip, which sets what the next thing placed
 * belongs to, and the selection bar, which changes what an existing one does.
 */

import type { Participant } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";

export function TeamSelect({
  participants,
  value,
  onValueChange,
  className = "w-36",
}: {
  participants: Participant[];
  /** A `setup.participants` id. */
  value: string;
  onValueChange: (team: string) => void;
  className?: string;
}) {
  return (
    <OptionSelect
      size="sm"
      className={className}
      value={value}
      onValueChange={onValueChange}
      placeholder="Team"
      options={participants.map((p) => ({
        value: p.id,
        label: p.name,
        icon: <Swatch participant={p} />,
      }))}
    />
  );
}

/** A participant's colour, as the launcher's 0..1 float RGB. */
function Swatch({ participant }: { participant: Participant }) {
  const [r, g, b] = participant.color;
  return (
    <span
      className="size-3 shrink-0 rounded-sm border border-border/60"
      style={{ backgroundColor: `rgb(${r * 255} ${g * 255} ${b * 255})` }}
    />
  );
}
