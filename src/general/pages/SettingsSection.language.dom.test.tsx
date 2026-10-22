// @vitest-environment happy-dom

/**
 * Issue #4591: the Language picker in General settings changes the language at
 * once, with no reload, and sets the document language.
 */

import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueueProvider } from "../../downloads/DownloadQueueProvider";
import { i18n, loadLocale } from "../../i18n";
import { useApplyLanguage } from "../../i18n/language";
import { SYSTEM_LANGUAGE } from "../../i18n/locales";
import UpdatesSettingsSection from "../../updater/pages/UpdatesSettingsSection";
import { UpdaterProvider } from "../../updater/UpdaterProvider";
import GeneralSettings from "./SettingsSection";

const store = new Map<string, unknown>();
const listeners = new Set<() => void>();

// A minimal in-memory stand-in for the frame settings store, so the picker and
// the provider see one value and re-render when it changes.
vi.mock("@picoframe/frame", async (importOriginal) => {
  const React = await import("react");
  return {
    ...(await importOriginal<typeof import("@picoframe/frame")>()),
    useSetting: <T,>(key: string, fallback: T) => {
      const [, bump] = React.useReducer((n: number) => n + 1, 0);
      React.useEffect(() => {
        listeners.add(bump);
        return () => void listeners.delete(bump);
      }, []);
      const value = (store.has(key) ? store.get(key) : fallback) as T;
      return [
        value,
        (v: T) => {
          store.set(key, v);
          for (const l of listeners) l();
        },
      ] as const;
    },
  };
});
// Radix Select needs real pointer events, so the wrapper is swapped for a
// native select that takes the same props, as other DOM tests here do.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: { value: string; label: string; hint?: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value} data-hint={o.hint}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));
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
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "1.2.2" }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: async () => {} }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: async () => null }));
vi.mock("../../notify/notify", () => ({ notify: async () => {} }));
vi.mock("../../profile/profile", () => ({ isUpdaterEnabled: () => true }));

import.meta.env.DEV = false;

function Applier() {
  useApplyLanguage();
  return null;
}

beforeEach(async () => {
  store.clear();
  await loadLocale("en");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Language picker", () => {
  it("swaps the updater strings and the document language without a reload", async () => {
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <Applier />
          <GeneralSettings />
          <DownloadQueueProvider>
            <UpdaterProvider>
              <UpdatesSettingsSection />
            </UpdaterProvider>
          </DownloadQueueProvider>
        </I18nProvider>,
      );
    });

    expect(screen.getByText("Check for updates")).toBeTruthy();
    expect(store.has("general.language")).toBe(false);

    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "fr" },
    });

    expect(await screen.findByText("Vérifier les mises à jour")).toBeTruthy();
    expect(screen.queryByText("Check for updates")).toBeNull();
    expect(store.get("general.language")).toBe("fr");
    expect(document.documentElement.lang).toBe("fr");
  });

  it("lists System and every locale in its own language", async () => {
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <GeneralSettings />
        </I18nProvider>,
      );
    });
    const names = within(screen.getByLabelText("Language"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names).toEqual([
      "System",
      "English",
      "Français",
      "Deutsch",
      "Español",
      "日本語",
      expect.stringContaining("中文"),
      // The pseudo-locale (#4593), listed because tests run as a dev build.
      "Pseudo",
    ]);
  });

  it("shows each locale's code beside its name, and nothing for System", async () => {
    await act(async () => {
      render(
        <I18nProvider i18n={i18n}>
          <GeneralSettings />
        </I18nProvider>,
      );
    });
    const hints = within(screen.getByLabelText("Language"))
      .getAllByRole("option")
      .map((o) => [o.getAttribute("value"), o.getAttribute("data-hint")]);
    expect(hints).toContainEqual(["de", "de"]);
    expect(hints).toContainEqual(["zh-Hans", "zh-Hans"]);
    expect(hints).toContainEqual([SYSTEM_LANGUAGE, null]);
  });

  it("shows the selected option's code in the closed trigger", async () => {
    const { OptionSelect } = await vi.importActual<
      typeof import("@/components/OptionSelect")
    >("@/components/OptionSelect");
    const options = [
      { value: SYSTEM_LANGUAGE, label: "System" },
      { value: "de", label: "Deutsch", hint: "de" },
    ];
    const { container, rerender } = render(
      <OptionSelect value="de" onValueChange={() => {}} options={options} />,
    );
    const hint = () => container.querySelector('[data-slot="select-hint"]');
    expect(hint()?.textContent).toBe("de");
    rerender(
      <OptionSelect
        value={SYSTEM_LANGUAGE}
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(hint()).toBeNull();
  });
});
