// @vitest-environment happy-dom

/**
 * The Setup row in General settings reopens the onboarding wizard.
 */

import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, loadLocale } from "../../i18n";
import { requestOnboardingRerun } from "../../onboarding/rerun";
import GeneralSettings from "./SettingsSection";

vi.mock("../../onboarding/rerun", () => ({
  requestOnboardingRerun: vi.fn(),
}));
vi.mock("@picoframe/frame", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@picoframe/frame")>()),
  useSetting: <T,>(_key: string, fallback: T) => [fallback, () => {}] as const,
}));
vi.mock("@/components/OptionSelect", () => ({ OptionSelect: () => null }));
vi.mock("../../general/advanced", () => ({
  useAdvancedModeSetting: () => [false, () => {}],
}));
vi.mock("../display", () => ({
  useEffectsSetting: () => [true, () => {}],
  usePerformanceModeSetting: () => [false, () => {}],
  useReduceMotionSetting: () => ["system", () => {}],
  useShowFrameRateSetting: () => [false, () => {}],
}));
vi.mock("../fullscreen", () => ({
  isFullscreenLocked: () => true,
  useFullscreenSetting: () => [false, () => {}],
}));
vi.mock("../splash", () => ({
  hasProfileSplash: () => false,
  useSplashSetting: () => [false, () => {}],
}));
vi.mock("../uiZoom", () => ({ useUiZoomSetting: () => [1, () => {}] }));
vi.mock("./AboutCoilbox", () => ({ AboutCoilbox: () => null }));

beforeEach(async () => {
  await loadLocale("en");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Setup row", () => {
  it("asks the onboarding wizard to run again", async () => {
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <GeneralSettings />
        </I18nProvider>,
      );
    });

    expect(screen.getByText("Setup")).toBeTruthy();
    expect(requestOnboardingRerun).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run setup again" }));

    expect(requestOnboardingRerun).toHaveBeenCalledTimes(1);
  });
});
