/**
 * Which of the two delivery routes the open project's game supports, and why
 * when one is not (issue #1268). Shown as a button because the workshop's
 * page already claims the window height for its two panes, the same reason
 * `DiagnosticsButton` in `content/pages/components/states.tsx` opens a drawer
 * rather than sitting as a strip along the bottom.
 *
 * Only the checkmark or cross is worth a glance from the toolbar. The reason
 * a route is missing, and the slot count when it is not, are the sort of
 * thing you read once and then stop looking at, so they live in the drawer
 * rather than beside the button.
 */
import { Button, Drawer } from "@picoframe/frame";
import { CircleCheck, CircleX, Route } from "lucide-react";
import { useState } from "react";
import type { ConfigOption } from "@/content/bindings";
import { deliveryRoutes } from "../../deliveryRoutes";

export function DeliveryRoutesButton({
  options,
  gameName,
}: {
  options: ConfigOption[];
  gameName: string;
}) {
  const [open, setOpen] = useState(false);
  const routes = deliveryRoutes(options, gameName);
  const availableCount = routes.filter((r) => r.available).length;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
        title={`Which of the ${routes.length} delivery routes ${gameName} supports`}
      >
        <Route className="size-3.5" />
        {availableCount} of {routes.length} routes
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Delivery routes"
        description={`How a change to ${gameName} can reach a running game.`}
        width="28rem"
      >
        <ul className="flex flex-col gap-3">
          {routes.map((r) => (
            <li key={r.route} className="flex gap-2">
              {r.available ? (
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">{r.label}</span>
                <span className="text-muted-foreground text-xs">
                  {r.detail}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  );
}
