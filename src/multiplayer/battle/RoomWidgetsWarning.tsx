import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo } from "react";
import { Link } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  type OffReason,
  roomWidgetVerdict,
  roomWidgetWarning,
} from "@/widgets/roomWarning";
import type { RoomWidgets } from "@/widgets/roomWidgets";
import { useWidgetSets } from "@/widgets/widgetSets";
import { optionValue } from "./battleOptions";

/**
 * Says, in the battle room, which of the player's widgets the room stops from
 * loading (issue #1292). Renders nothing when the room costs the player none.
 */
export function RoomWidgetsWarning({
  widgets,
  scriptTags,
  spectating,
}: {
  widgets: RoomWidgets | null;
  scriptTags: Record<string, string>;
  spectating: boolean;
}) {
  const { t } = useLingui();
  const sets = useWidgetSets();
  const warning = useMemo(() => {
    if (!widgets) return null;
    const verdict = roomWidgetVerdict({
      rules: widgets.rules,
      option: (key) => optionValue(scriptTags, "mod", key),
      spectating,
      configFlag: widgets.configFlag,
      localWidgets: widgets.localWidgets,
    });
    return roomWidgetWarning(verdict, widgets.rows, widgets.game, sets);
  }, [widgets, scriptTags, spectating, sets]);
  if (!widgets || !warning) return null;

  const game = widgets.game.game;
  const reasons: Record<OffReason, string> = {
    option: t`This room does not allow player widgets.`,
    "anonymous-colours": t`This room hides team colours, which turns off player widgets.`,
    "config-flag": t`Player widgets are switched off in the widget list of ${game}.`,
    "local-widgets": t`${game} loads player widgets only when Local Widgets Config is on in its widget list.`,
  };

  const noOrders = t`This room turns off widgets that give orders.`;
  return (
    <div className="space-y-1 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-700 dark:text-amber-400">
      {warning.off && warning.blocked.length > 0 && (
        <Group
          sentences={[
            reasons[warning.off],
            plural(warning.blocked.length, {
              one: "# widget of yours will not load.",
              other: "# widgets of yours will not load.",
            }),
          ]}
          names={warning.blocked}
        />
      )}
      {warning.skipped.length > 0 && (
        <Group
          sentences={[
            noOrders,
            plural(warning.skipped.length, {
              one: "# widget says it gives orders, so the game skips it.",
              other: "# widgets say they give orders, so the game skips them.",
            }),
          ]}
          names={warning.skipped}
        />
      )}
      {warning.failing.length > 0 && (
        <Group
          sentences={[
            ...(warning.skipped.length > 0 ? [] : [noOrders]),
            plural(warning.failing.length, {
              one: "# widget gives orders without saying so. It will load, then raise an error each time it does.",
              other:
                "# widgets give orders without saying so. They will load, then raise an error each time they do.",
            }),
          ]}
          names={warning.failing}
        />
      )}
      <p>
        <Link to="/library/widgets" className="underline">
          <Trans>Open your widgets</Trans>
        </Link>
      </p>
    </div>
  );
}

/** A sentence with the widgets it is about behind a button. */
function Group({ sentences, names }: { sentences: string[]; names: string[] }) {
  return (
    <Collapsible>
      <p>
        {sentences.join(" ")}{" "}
        <CollapsibleTrigger className="underline">
          <Trans>Show which</Trans>
        </CollapsibleTrigger>
      </p>
      <CollapsibleContent>
        <ul className="list-inside list-disc">
          {names.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
