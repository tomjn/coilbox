import { NavGate } from "@picoframe/frame";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import type { ComponentType } from "react";
import { CoilboxGlyph } from "../components/CoilboxGlyph";
import { isProfileHidden } from "../profile/hidden";
import { isHubEnabled } from "../profile/profile";
import HubSettings from "./pages/SettingsSection";

/**
 * The Coilbox hub plugin (issue #1347): one screen listing what other players
 * have shared, with the same filters the website's gallery has.
 *
 * First in the Downloads group. It shipped as a group of one with no label,
 * which the frame draws as a stray top-level item with nothing saying what it
 * belongs to. Downloads is where things come from, and other people's containers
 * are things that come from somewhere, so it goes at the head of that list.
 *
 * The nav item deliberately has no `end`, so an item's own page (`/hub/<id>`)
 * keeps it lit rather than leaving the sidebar looking like nowhere is open.
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
      title: "Coilbox hub",
      order: 40,
      icon: CoilboxGlyph,
      Component: HubSettings,
      useVisible: isHubEnabled,
    },
  ],
  nav: [
    {
      // First in Downloads, above Browse Rapid: the hub is another place things
      // come from, and a group of one with no label read as a stray item.
      id: "downloads",
      label: "Downloads",
      order: 20,
      items: [
        {
          id: "hub.browse",
          label: "Coilbox hub",
          to: "/hub",
          order: -1,
          icon: CoilboxGlyph,
          useVisible: visible,
        },
      ],
    },
  ],
  routes: [
    {
      path: "hub",
      lazy: gated(() => import("./pages/BrowsePage")),
      crumb: "Coilbox hub",
    },
    {
      // One item in full, and where a `<hub>/i/<id>` link lands (issue #1366).
      // The id is an opaque uuid and the title is only known once the page has
      // fetched it, so the crumb is the generic word.
      path: "hub/:id",
      lazy: gated(() => import("./pages/ItemPage")),
      crumb: "Item",
    },
  ],
};

export default hubPlugin;
