import { NavGate } from "@picoframe/frame";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Globe } from "lucide-react";
import type { ComponentType } from "react";
import { isProfileHidden } from "../profile/hidden";
import { isHubEnabled } from "../profile/profile";
import HubSettings from "./pages/SettingsSection";

/**
 * The community hub plugin (issue #1347): one screen listing what other players
 * have shared, with the same filters the website's gallery has.
 *
 * A top-level nav entry rather than a child of Downloads. Downloads is about
 * fetching maps, games and engines from known sources. The hub is other people's
 * containers, which to a player is a different errand.
 *
 * The import box at Settings > Import stays where it is (`../deeplink`). A
 * profile can switch the hub off, and somebody who was handed a link still needs
 * somewhere to paste it when it is.
 *
 * The settings section (`/settings/hub`, issue #1353) is the control for the
 * `hub.url` user setting that `useHubUrl` (`./config`) already layers over a
 * distribution profile's `hubUrl` and the built-in default. It shares the plain
 * `isHubEnabled()` gate rather than `visible` above, so it stays reachable
 * whenever the hub is on even if a profile hides the browse nav item specifically
 * (`hub.browse`). Other hub consumers, like the share drawer's "open hub"
 * button, still read the setting.
 */

/** Both gates the nav item applies, so the route can apply the same pair. */
const visible = () => isHubEnabled() && !isProfileHidden("hub.browse");

/** Redirect home when the hub is off or hidden, so the route is no more
 * reachable than the nav item that leads to it. */
function gated(loader: () => Promise<{ default: ComponentType }>) {
  return async () => {
    const { default: Page } = await loader();
    function GatedHubPage() {
      return (
        <NavGate use={visible}>
          <Page />
        </NavGate>
      );
    }
    return { default: GatedHubPage };
  };
}

const hubPlugin: FramePlugin = {
  id: "hub",
  version: "0.0.0",
  settings: [
    {
      id: "hub",
      title: "Community hub",
      icon: Globe,
      Component: HubSettings,
      useVisible: isHubEnabled,
    },
  ],
  nav: [
    {
      // No label: a group of one, which the frame renders as a top-level item.
      id: "hub",
      order: 25,
      items: [
        {
          id: "hub.browse",
          label: "Community hub",
          to: "/hub",
          end: true,
          icon: Globe,
          useVisible: visible,
        },
      ],
    },
  ],
  routes: [
    {
      path: "hub",
      lazy: gated(() => import("./pages/BrowsePage")),
      crumb: "Community hub",
    },
  ],
};

export default hubPlugin;
