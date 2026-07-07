import { type FramePlugin, framePlugin } from "@picoframe/frame";
import animationPlugin from "./animation";
// picoframe:imports-start
import campaignPlugin from "./campaign";
import conquestPlugin from "./conquest";
import contentPlugin from "./content";
import downloadsPlugin from "./downloads";
import gameUpdatesPlugin from "./game-updates";
import generalPlugin from "./general";
import lobbyServersPlugin from "./lobby-servers";
import mapconvPlugin from "./mapconv";
import multiplayerPlugin from "./multiplayer";
import playPlugin from "./play";
import profilePlugin from "./profile";
import uberstressPlugin from "./uberstress";
import updaterPlugin from "./updater";
// picoframe:imports-end

/** The app's plugin list. `picoframe add <plugin>` edits this file. */
export const plugins: FramePlugin[] = [
  framePlugin,
  // picoframe:plugins-start
  downloadsPlugin,
  uberstressPlugin,
  mapconvPlugin,
  animationPlugin,
  contentPlugin,
  playPlugin,
  campaignPlugin,
  conquestPlugin,
  lobbyServersPlugin,
  multiplayerPlugin,
  // picoframe:plugins-end
  generalPlugin,
  profilePlugin,
  updaterPlugin,
  gameUpdatesPlugin,
];
