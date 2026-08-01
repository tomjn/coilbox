import { type FramePlugin, framePlugin } from "@picoframe/frame";
import animationPlugin from "./animation";
// picoframe:imports-start
import campaignPlugin from "./campaign";
import conquestPlugin from "./conquest";
import contentPlugin from "./content";
import deepLinkPlugin from "./deeplink";
import downloadsPlugin from "./downloads";
import gameUpdatesPlugin from "./game-updates";
import generalPlugin from "./general";
import legoPlugin from "./lego";
import lobbyServersPlugin from "./lobby-servers";
import mapconvPlugin from "./mapconv";
import multiplayerPlugin from "./multiplayer";
import notifyPlugin from "./notify";
import playPlugin from "./play";
import profilePlugin from "./profile";
import runlitePlugin from "./runlite";
import scenarioPlugin from "./scenario";
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
  legoPlugin,
  contentPlugin,
  playPlugin,
  campaignPlugin,
  scenarioPlugin,
  conquestPlugin,
  runlitePlugin,
  lobbyServersPlugin,
  multiplayerPlugin,
  // picoframe:plugins-end
  deepLinkPlugin,
  generalPlugin,
  profilePlugin,
  updaterPlugin,
  gameUpdatesPlugin,
  notifyPlugin,
];
