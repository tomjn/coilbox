import { type ConfigOption, contentWidgetStatus } from "@/content/bindings";
import { sameOptionValue } from "./modOptions";

/**
 * Games such as Splinter Faction load loose widgets from a data folder only
 * when this mod option is on, and ship it off (issue #5190). Without it a
 * widget coilbox installed never loads and the infolog says "Skipping N user
 * widget file(s)".
 */
export const USER_WIDGETS_OPTION = "allowuserwidgets";

/**
 * Whether any widget coilbox ships is installed under a content root. A root
 * that cannot be read counts as none, so a failed check never stops a launch.
 */
export async function coilboxWidgetInstalled(
  rootPath: string,
): Promise<boolean> {
  const installed = await Promise.all(
    (["blueprints", "skeleton"] as const).map((widget) =>
      contentWidgetStatus({ rootPath, widget }).then(
        (s) => s.installed,
        () => false,
      ),
    ),
  );
  return installed.some(Boolean);
}

/**
 * The mod options a skirmish start script holds, with `allowuserwidgets=1`
 * added when the game defines that option, ships it off and a coilbox widget is
 * installed. A value the player set, even `0`, is kept as it is. The option is
 * read from the game's own option list, so a game without it gets nothing.
 */
export function withUserWidgets(
  values: Record<string, string>,
  schema: ConfigOption[],
  widgetInstalled: boolean,
): Record<string, string> {
  if (!widgetInstalled || USER_WIDGETS_OPTION in values) return values;
  const option = schema.find(
    (o) => o.type !== "section" && o.key === USER_WIDGETS_OPTION,
  );
  if (!option || sameOptionValue(option, option.default ?? "", "1"))
    return values;
  return { ...values, [USER_WIDGETS_OPTION]: "1" };
}
