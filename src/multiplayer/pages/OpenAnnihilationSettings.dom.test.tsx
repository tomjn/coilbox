// @vitest-environment happy-dom

/**
 * The Open Annihilation settings section (issue #4943). The program is found on
 * its own where OA's installer puts it, a picked file is stored only when it
 * prints an OA version, and a refusal says why and changes nothing.
 */

import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const MAC_OA = {
  path: "/Applications/Open Annihilation.app/Contents/MacOS/open-annihilation",
  version: "Open Annihilation 0.8.9 (macos-universal arm64, 9eb18ad4)",
};

const bindings = vi.hoisted(() => ({
  playOaFind: vi.fn(),
  playOaCheck: vi.fn(),
}));
vi.mock("../../play/bindings", () => bindings);

const dialog = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => dialog);

const settings: Record<string, unknown> = {};
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useSetting: (key: string, initial: unknown) => {
    const [value, set] = useState(key in settings ? settings[key] : initial);
    return [
      value,
      (next: unknown) => {
        settings[key] = next;
        set(next);
      },
    ];
  },
}));

import { OA_PROGRAM_KEY } from "../openAnnihilation";
import OpenAnnihilationSettings from "./OpenAnnihilationSettings";

/** What a Rust `UiError` looks like once it reaches a rejected promise. */
const refusal = (code: string, params: Record<string, string>, text: string) =>
  new Error(JSON.stringify({ code, params, fallback: text }));

function show() {
  return render(
    <I18nProvider i18n={i18n}>
      <OpenAnnihilationSettings />
    </I18nProvider>,
  );
}

/** The section is busy while it checks on open, and its buttons wait for that. */
const ready = () =>
  waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /choose/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );

const programField = () =>
  screen.getAllByRole("textbox")[0] as HTMLInputElement;

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  for (const key of Object.keys(settings)) delete settings[key];
  bindings.playOaFind.mockReset().mockResolvedValue({ found: null });
  bindings.playOaCheck.mockReset();
  dialog.open.mockReset();
});

afterEach(cleanup);

it("fills an empty setting from OA's usual place and shows the version", async () => {
  bindings.playOaFind.mockResolvedValue({ found: MAC_OA });
  show();

  await waitFor(() => expect(programField().value).toBe(MAC_OA.path));
  expect(screen.getByDisplayValue(MAC_OA.version)).toBeTruthy();
  expect(settings[OA_PROGRAM_KEY]).toEqual(MAC_OA);
});

it("leaves the setting empty and says nothing when OA is not in its usual place", async () => {
  show();

  await waitFor(() => expect(bindings.playOaFind).toHaveBeenCalled());
  expect(programField().value).toBe("");
  expect(settings[OA_PROGRAM_KEY]).toBeUndefined();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("stores a picked program that prints an OA version", async () => {
  const unpacked = {
    path: "/home/me/oa/open-annihilation",
    version: "Open Annihilation 0.8.9 (linux-x86_64, abcd1234)",
  };
  dialog.open.mockResolvedValue(unpacked.path);
  bindings.playOaCheck.mockResolvedValue(unpacked);
  show();
  await ready();

  fireEvent.click(screen.getByRole("button", { name: /choose/i }));

  await waitFor(() => expect(programField().value).toBe(unpacked.path));
  expect(bindings.playOaCheck).toHaveBeenCalledWith({ path: unpacked.path });
  expect(screen.getByDisplayValue(unpacked.version)).toBeTruthy();
  expect(settings[OA_PROGRAM_KEY]).toEqual(unpacked);
});

it("refuses a program that is not OA, says why, and keeps the stored one", async () => {
  settings[OA_PROGRAM_KEY] = MAC_OA;
  bindings.playOaCheck.mockImplementation(
    async ({ path }: { path: string }) => {
      if (path === MAC_OA.path) return MAC_OA;
      throw refusal(
        "play.oa.not_oa",
        { path },
        `${path} is not Open Annihilation. Choose the open-annihilation file.`,
      );
    },
  );
  dialog.open.mockResolvedValue("/bin/ls");
  show();
  await ready();
  expect(bindings.playOaCheck).toHaveBeenCalledWith({ path: MAC_OA.path });

  fireEvent.click(screen.getByRole("button", { name: /choose/i }));

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "/bin/ls is not Open Annihilation. Choose the open-annihilation file.",
  );
  expect(programField().value).toBe(MAC_OA.path);
  expect(settings[OA_PROGRAM_KEY]).toEqual(MAC_OA);
});

it("stores nothing when the first pick is refused", async () => {
  dialog.open.mockResolvedValue("/bin/ls");
  bindings.playOaCheck.mockRejectedValue(
    refusal(
      "play.oa.not_oa",
      { path: "/bin/ls" },
      "/bin/ls is not Open Annihilation.",
    ),
  );
  show();
  await ready();

  fireEvent.click(screen.getByRole("button", { name: /choose/i }));

  await screen.findByRole("alert");
  expect(programField().value).toBe("");
  expect(settings[OA_PROGRAM_KEY]).toBeUndefined();
});

it("leaves the setting alone when the picker is cancelled", async () => {
  dialog.open.mockResolvedValue(null);
  show();
  await ready();

  fireEvent.click(screen.getByRole("button", { name: /choose/i }));

  await waitFor(() => expect(dialog.open).toHaveBeenCalled());
  expect(bindings.playOaCheck).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reads the stored program's version again, because OA updates itself", async () => {
  settings[OA_PROGRAM_KEY] = MAC_OA;
  const updated = {
    ...MAC_OA,
    version: "Open Annihilation 0.9.0 (macos-universal arm64, 11112222)",
  };
  bindings.playOaCheck.mockResolvedValue(updated);
  show();

  await waitFor(() =>
    expect(screen.getByDisplayValue(updated.version)).toBeTruthy(),
  );
  expect(settings[OA_PROGRAM_KEY]).toEqual(updated);
  expect(bindings.playOaFind).not.toHaveBeenCalled();
});

it("says so when the stored program no longer runs, and keeps the path", async () => {
  settings[OA_PROGRAM_KEY] = MAC_OA;
  bindings.playOaCheck.mockRejectedValue(
    refusal("play.oa.not_a_file", { path: MAC_OA.path }, "gone"),
  );
  show();

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(programField().value).toBe(MAC_OA.path);
  expect(settings[OA_PROGRAM_KEY]).toEqual(MAC_OA);
});

it("tells the player when Find has nothing to find", async () => {
  show();
  await ready();
  expect(bindings.playOaFind).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole("button", { name: /find/i }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(bindings.playOaFind).toHaveBeenCalledTimes(2);
});
