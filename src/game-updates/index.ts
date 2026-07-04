import type { FramePlugin } from "@picoframe/plugin-sdk";
import { Gamepad2 } from "lucide-react";
import { getProfile } from "../profile/profile";
import GameUpdateBadge from "./GameUpdateBadge";
import { GameUpdatesProvider } from "./GameUpdatesProvider";
import GameUpdatesSection from "./pages/GameUpdatesSection";

/** True when the loaded distribution profile names a game-update repo. */
const hasUpdateRepo = () => !!getProfile().release?.repo;

/**
 * Game-updates plugin. When a distribution profile names a GitHub repo
 * (`release.repo`), this checks that repo's latest release for a newer game
 * archive than the one installed, and offers an in-app download + unitsync rescan
 * (and pulls an updated profile.json if the release ships one). Inert — settings
 * section hidden, badge never shown, provider a no-op — in vanilla Coilbox.
 *
 * The settings Component is imported eagerly (not lazy): the frame settings page
 * renders it directly without a Suspense boundary, so React.lazy can't be used.
 */
const gameUpdatesPlugin: FramePlugin = {
  id: "game-updates",
  version: "0.0.0",
  routes: [],
  Provider: GameUpdatesProvider,
  slots: [{ slot: "topbar.right", order: 1, Component: GameUpdateBadge }],
  settings: [
    {
      id: "game-updates",
      title: "Game updates",
      icon: Gamepad2,
      useVisible: hasUpdateRepo,
      Component: GameUpdatesSection,
    },
  ],
};

export default gameUpdatesPlugin;
