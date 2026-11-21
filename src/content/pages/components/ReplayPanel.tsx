import { useLingui } from "@lingui/react/macro";
import { type ReactNode, useCallback } from "react";
import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** The tabs of the replay page's panel, in the order they are listed. */
export const REPLAY_TABS = ["summary", "economy", "builds", "events"] as const;
export type ReplayTab = (typeof REPLAY_TABS)[number];

/** The address's `?tab=`, which holds the open tab so a link opens on it. */
export const TAB_PARAM = "tab";

/** The tab a page opens on when its address names none that can be shown. */
const DEFAULT_TAB: ReplayTab = "summary";

/**
 * The open tab, kept in the address beside the time. A name that is not a tab,
 * or is of a tab this page does not list, opens the Summary. Choosing a tab
 * replaces the address's entry rather than adding one, so Back leaves the page
 * and does not step through the tabs.
 */
export function useReplayTab(
  listed: readonly ReplayTab[],
): [ReplayTab, (tab: ReplayTab) => void] {
  const [params, setParams] = useSearchParams();
  const named = params.get(TAB_PARAM);
  const tab = listed.find((id) => id === named) ?? DEFAULT_TAB;
  const choose = useCallback(
    (next: ReplayTab) =>
      setParams(
        (was) => {
          const out = new URLSearchParams(was);
          out.set(TAB_PARAM, next);
          return out;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [tab, choose];
}

/**
 * The panel beside the map (#5304): one tab at a time, so the page's sections
 * are a click apart and not a scroll apart. A tab not in `content` is not
 * listed. The tabs that are listed stay mounted when another is open, so a
 * chart keeps its metric and a section that is loading carries on. When the
 * page has two columns the panel is as tall as they are, and a tab taller than
 * that scrolls inside itself. When the page stacks, the panel takes the height
 * it needs.
 */
export function ReplayPanel({
  tab,
  onTab,
  content,
}: {
  tab: ReplayTab;
  onTab: (tab: ReplayTab) => void;
  content: Partial<Record<ReplayTab, ReactNode>>;
}) {
  const { t } = useLingui();
  const names: Record<ReplayTab, string> = {
    summary: t`Summary`,
    economy: t`Economy`,
    builds: t`Build orders`,
    events: t`Events and chat`,
  };
  const listed = REPLAY_TABS.filter((id) => content[id] !== undefined);
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => onTab(next as ReplayTab)}
      className="min-h-0 gap-3 xl:h-full"
    >
      <TabsList className="max-w-full shrink-0 justify-start">
        {listed.map((id) => (
          <TabsTrigger key={id} value={id}>
            {names[id]}
          </TabsTrigger>
        ))}
      </TabsList>
      {listed.map((id) => (
        <TabsContent
          key={id}
          value={id}
          forceMount
          className="flex min-h-0 flex-col gap-5 focus-visible:ring-2 focus-visible:ring-ring data-[state=inactive]:hidden xl:overflow-y-auto"
        >
          {content[id]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
