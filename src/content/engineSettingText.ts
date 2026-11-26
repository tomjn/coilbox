import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { EngineConfigSetting } from "./bindings";

/**
 * The words for each engine setting, per language.
 *
 * The unitsync worker's catalog in `crates/coilbox-unitsync-worker/src/config.rs`
 * carries English for every label, hint and choice. It is the fallback here, for
 * a key this table does not have yet. The frontend owns the words, as it does
 * for metric labels in `metricLabels.ts`, so a translator sees them in the
 * catalog. `engineSettingText.test.ts` fails when the two disagree.
 */
export const ENGINE_SETTING_LABEL: Record<string, MessageDescriptor> = {
  Fullscreen: msg`Fullscreen`,
  WindowBorderless: msg`Borderless window`,
  XResolution: msg`Resolution width`,
  YResolution: msg`Resolution height`,
  XResolutionWindowed: msg`Windowed width`,
  YResolutionWindowed: msg`Windowed height`,
  VSync: msg`VSync`,
  Shadows: msg`Shadows`,
  ShadowMapSize: msg`Shadow detail`,
  GroundDetail: msg`Ground detail`,
  MaxParticles: msg`Max particles`,
  MaxNanoParticles: msg`Max nano particles`,
  Water: msg`Water rendering`,
  MSAALevel: msg`Anti-aliasing`,
  AdvMapShading: msg`Advanced map shading`,
  snd_volmaster: msg`Master volume`,
  snd_volgeneral: msg`General volume`,
  snd_volunitreply: msg`Unit reply volume`,
  snd_volbattle: msg`Battle volume`,
  snd_volui: msg`UI volume`,
  snd_volmusic: msg`Music volume`,
  MaxSounds: msg`Max simultaneous sounds`,
  CamMode: msg`Camera mode`,
  HardwareCursor: msg`Hardware cursor`,
  ScrollWheelSpeed: msg`Scroll wheel speed`,
  EdgeMoveWidth: msg`Edge scroll width`,
  EdgeMoveDynamic: msg`Dynamic edge scroll`,
  FPSFOV: msg`FPS camera FOV`,
  DoubleClickTime: msg`Double-click time`,
  MiddleClickScrollSpeed: msg`Middle-click scroll speed`,
  name: msg`Player name`,
  TeamHighlight: msg`Team highlight`,
};

export const ENGINE_SETTING_HINT: Record<string, MessageDescriptor> = {
  Fullscreen: msg`For borderless fullscreen, turn this off and Borderless window on.`,
  XResolution: msg`0 uses your desktop resolution.`,
  VSync: msg`Syncs frames to your monitor. Adaptive drops the sync when the frame rate falls below it.`,
  ShadowMapSize: msg`Higher is sharper and slower.`,
  GroundDetail: msg`Low values make cliffs look jagged.`,
  Water: msg`Can also be changed during a game.`,
  MSAALevel: msg`Smooths jagged edges. Costly at high sample counts.`,
  HardwareCursor: msg`Draws the cursor outside the game, so it stays responsive at a low frame rate. Some drivers do not support it in fullscreen.`,
  ScrollWheelSpeed: msg`Negative values scroll the other way.`,
  EdgeMoveWidth: msg`How much of the screen edge scrolls the camera, as a share of the screen.`,
  EdgeMoveDynamic: msg`Scroll faster the closer the pointer is to the edge.`,
  DoubleClickTime: msg`In milliseconds.`,
  name: msg`Lobbies replace this with your lobby name, so it shows up in replays and when the engine is started on its own.`,
};

/** The named choices, keyed by setting and then by the stored value. */
export const ENGINE_SETTING_OPTION: Record<
  string,
  Record<string, MessageDescriptor>
> = {
  VSync: { "0": msg`Off`, "1": msg`On`, "-1": msg`Adaptive` },
  Shadows: {
    "-1": msg`Off, and not loaded`,
    "0": msg`Off`,
    "1": msg`Full`,
    "2": msg`Fast, skipping terrain`,
  },
  ShadowMapSize: {
    "1024": msg`Low (1024)`,
    "2048": msg`Medium (2048)`,
    "4096": msg`High (4096)`,
    "8192": msg`Very high (8192)`,
  },
  Water: {
    "0": msg`Basic`,
    "1": msg`Reflective`,
    "2": msg`Reflective and refractive`,
    "3": msg`Dynamic`,
    "4": msg`Bumpmapped`,
  },
  MSAALevel: {
    "0": msg`Off`,
    "2": msg`2 samples`,
    "4": msg`4 samples`,
    "8": msg`8 samples`,
    "16": msg`16 samples`,
  },
  CamMode: {
    "0": msg`FPS`,
    "1": msg`Overhead`,
    "2": msg`Spring`,
    "3": msg`Rotatable overhead`,
    "4": msg`Free`,
    "5": msg`Overview`,
  },
};

/**
 * A setting's label, hint and choices in the current language. Call it when the
 * setting is drawn, after a catalog is active, and not when a module loads.
 */
export function translateEngineSetting(
  s: EngineConfigSetting,
): EngineConfigSetting {
  const label = ENGINE_SETTING_LABEL[s.key];
  const hint = ENGINE_SETTING_HINT[s.key];
  const options = ENGINE_SETTING_OPTION[s.key];
  return {
    ...s,
    label: label ? i18n._(label) : s.label,
    hint: hint ? i18n._(hint) : s.hint,
    options: s.options?.map((o) => {
      const word = options?.[o.value];
      return word ? { ...o, label: i18n._(word) } : o;
    }),
  };
}
