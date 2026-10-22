import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";

import { CheckField } from "@/components/Field";
import type { JoinSummary } from "../../connectors";
import { NumberField } from "./TransformFields";

const NEUTRAL = "#a1a1aa";

/**
 * The piece panel's "Joined to" section: what the piece is joined to, where it
 * rests on that face, the Detach action, and the viewport's free face toggle.
 */
export function JoinedTo({
  join,
  onDetach,
  onPlace,
  notice,
  showFree,
  onShowFreeChange,
}: {
  join: JoinSummary | null;
  onDetach: () => void;
  /** The offset along the face or the twist (radians) a field was set to. */
  onPlace: (change: { offset?: [number, number]; twist?: number }) => void;
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
