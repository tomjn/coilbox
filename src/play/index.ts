import { msg, t } from "@lingui/core/macro";
import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Clapperboard, FileText, Save, Swords } from "lucide-react";
import { lazyText } from "../i18n/pluginText";
import { RECORDS_GROUP } from "../recordsGroup";
import InGameBadge from "./InGameBadge";
import { PlayProvider } from "./PlayProvider";
import EngineLogSection from "./pages/EngineLogSection";

/**
 * The Play plugin's frontend half — a **Play** sidebar section whose first screen
 * is a Basic Singleplayer (skirmish) launcher. It configures a start script (map,
 * game, factions, AI opponents, colours, teams/allyteams, spectate) and launches
 * the preferred engine via the `tauri-plugin-coilbox-play` crate (ACL id
 * `coilbox-play`). Skirmish-AI enumeration comes from the unitsync plugin.
 *
 * Replays (list + detail) moved here from Content in #467; the pages themselves
 * still live in `content/pages` (they're built on the content plugin's unitsync
 * hooks) — only the nav item and route registration moved.
 */
const playPlugin: FramePlugin = {
  id: "play",
  version: "0.0.0",
  nav: [
    {
      id: "play",
      label: lazyText(msg`Play`),
      order: 5,
      items: [
        {
          id: "play.skirmish",
          label: lazyText(msg`Singleplayer`),
          to: "/play/skirmish",
          order: 0,
          icon: Swords,
        },
        {
          id: "play.savegames",
          label: lazyText(msg`Save Games`),
          to: "/play/savegames",
          // Last in the aggregated Play section (Campaigns=1, Conquest=2 arrive
          // from sibling plugins), so keep this clearly above them.
          order: 10,
          icon: Save,
        },
      ],
    },
    {
      ...RECORDS_GROUP,
      items: [
        {
          id: "play.replays",
          label: lazyText(msg`Replays`),
          to: "/play/replays",
          // Last in Records: the raw material behind Career and Player stats.
          order: 2,
          icon: Clapperboard,
        },
      ],
    },
  ],
  // The URL segment above every page here, which has no route of its own.
  crumbs: { "/play": lazyText(msg`Play`) },
  routes: [
    {
      path: "play/skirmish",
      lazy: () => import("./pages/SkirmishPage"),
      crumb: lazyText(msg`Singleplayer`),
    },
    {
      path: "play/replays",
      lazy: () => import("../content/pages/ReplaysPage"),
      crumb: lazyText(msg`Replays`),
      // Replays lives in Records now, so the trail reads "Replays" like Career
      // and Player stats, not "Play / Replays". The URL is unchanged.
      crumbSpan: 2,
    },
    {
      path: "play/replays/:name",
      lazy: () => import("../content/pages/ReplayDetailPage"),
      crumb: (c) => c.params.name ?? t`Replay`,
    },
    {
      path: "play/savegames",
      lazy: () => import("./pages/SavegamesPage"),
      crumb: lazyText(msg`Save Games`),
    },
  ],
  // Declared into Engine Settings, which the content plugin owns, because that
  // is where somebody goes looking for what the engine did. The code stays here
  // because it finds the log the way the crash drawer does.
  settings: [
    {
      id: "engine-log",
      title: lazyText(msg`Engine log`),
      description: lazyText(
        msg`Where the engine last wrote its log, and the system it ran on.`,
      ),
      parent: "engine-settings",
      order: 70,
      icon: FileText,
      width: "lg",
      Component: EngineLogSection,
    },
  ],
  Provider: PlayProvider,
  slots: [{ slot: "topbar.right", order: -10, Component: InGameBadge }],
};

export default playPlugin;
