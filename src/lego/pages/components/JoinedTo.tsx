import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { useEffect, useState } from "react";

import { CheckField } from "@/components/Field";
import type { JoinSummary } from "../../connectors";
import { NumberField } from "./TransformFields";

const NEUTRAL = "#a1a1aa";

/**
 * The piece panel's "Joined to" section: what the piece is joined to, where it
 * rests on that face, the Detach action, and the viewport's free face toggle.
 * When the unit breaks apart, also how this join breaks (#4503).
 */
export function JoinedTo({
  join,
  onDetach,
  onPlace,
  onBreak,
  notice,
  showFree,
  onShowFreeChange,
}: {
  join: JoinSummary | null;
  onDetach: () => void;
  /** The offset along the face or the twist (radians) a field was set to. */
  onPlace: (change: { offset?: [number, number]; twist?: number }) => void;
  /** Set when the unit has Break apart: a join mark was changed. A strength
   *  of null goes back to the group's size. */
  onBreak?: (change: {
    unbreakable?: boolean;
    strength?: number | null;
  }) => void;
  /** One line on why the piece was just freed, shown while it is free. */
  notice?: string | null;
  showFree: boolean;
  onShowFreeChange: (show: boolean) => void;
}) {
  const { t } = useLingui();
  const joinLabel = ({
    broken,
    parentName,
    toName,
    connectorName,
  }: JoinSummary) =>
    broken
      ? t`Broken: ${parentName} (${toName}) by its ${connectorName}`
      : t`${parentName} (${toName}) by its ${connectorName}`;
  return (
    <div className="mt-2">
      <span className="text-xs text-muted-foreground">
        <Trans>Joined to</Trans>
      </span>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {join ? (
          <>
            <span
              className={`min-w-0 flex-1 truncate ${
                join.broken ? "text-destructive" : ""
              }`}
              title={
                join.broken
                  ? t`A face this join names is missing from a part, so the piece stays where it was`
                  : undefined
              }
            >
              {joinLabel(join)}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs"
              onClick={onDetach}
            >
              <Trans>Detach</Trans>
            </Button>
          </>
        ) : (
          <span>{notice ?? t`Free`}</span>
        )}
      </div>

      {join ? (
        <div className="mt-1 grid grid-cols-3 gap-1">
          <NumberField
            value={join.offset[0]}
            axis=""
            colour={NEUTRAL}
            label={t`Along`}
            onCommit={(along) => onPlace({ offset: [along, join.offset[1]] })}
          />
          <NumberField
            value={join.offset[1]}
            axis=""
            colour={NEUTRAL}
            label={t`Up`}
            onCommit={(up) => onPlace({ offset: [join.offset[0], up] })}
          />
          <NumberField
            value={(join.twist * 180) / Math.PI}
            axis="°"
            colour={NEUTRAL}
            label={t`Twist`}
            onCommit={(degrees) =>
              onPlace({ twist: (degrees * Math.PI) / 180 })
            }
          />
        </div>
      ) : null}

      {join && onBreak ? (
        <div className="mt-2 flex min-h-7 items-center gap-2">
          <div className="flex-1">
            <CheckField
              label={t`Unbreakable`}
              checked={join.unbreakable}
              onChange={(unbreakable) => onBreak({ unbreakable })}
            />
          </div>
          {join.unbreakable ? null : (
            <StrengthField
              value={join.strength}
              onCommit={(strength) => onBreak({ strength })}
            />
          )}
        </div>
      ) : null}

      <div className="mt-1">
        <CheckField
          label={t`Show free faces`}
          checked={showFree}
          onChange={onShowFreeChange}
        />
      </div>
    </div>
  );
}

/**
 * A join's strength, in pieces. Left empty the join goes by the size of the
 * group it throws off, so clearing the field takes the strength away.
 */
function StrengthField({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const { t } = useLingui();
  const shown = value === null ? "" : String(value);
  const [draft, setDraft] = useState(shown);

  useEffect(() => setDraft(shown), [shown]);

  function commit() {
    if (draft.trim() === "") {
      if (value !== null) onCommit(null);
      return;
    }
    const parsed = Number.parseFloat(draft);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(shown);
      return;
    }
    if (parsed !== value) onCommit(parsed);
  }

  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the <Input> control (implicit label association)
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">
        <Trans>Strength</Trans>
      </span>
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(shown);
        }}
        inputMode="decimal"
        placeholder={t`By size`}
        className="h-7 w-20 px-1 text-right text-xs"
      />
    </label>
  );
}
