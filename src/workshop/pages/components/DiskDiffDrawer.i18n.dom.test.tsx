// @vitest-environment happy-dom
/**
 * Issue #4603: the disk diff drawer's counts are ICU plurals, so one file and
 * three files read right in English and in another language. The catalog here
 * is a fixture, not a real translation. It rewords two messages so a translated
 * plural can be told from the English source, and uses `fr`, where the engine
 * picks `one` for 0 and 1 and `other` from 2.
 */
import { i18n } from "@lingui/core";
import { compileMessage } from "@lingui/message-utils/compileMessage";
import { generateMessageId } from "@lingui/message-utils/generateMessageId";
import { I18nProvider } from "@lingui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileDiff } from "../../inPlace";

let diffsResponse: FileDiff[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: (_plugin: string, command: string) => async () => {
    if (command === "workshop_in_place_diffs") return diffsResponse;
    if (command === "workshop_undo_in_place")
      return { restored: diffsResponse.map((d) => d.file), deleted: [] };
    throw new Error(`unexpected command ${command}`);
  },
}));

import { DiskDiffDrawer } from "./DiskDiffDrawer";

function files(count: number): FileDiff[] {
  return Array.from({ length: count }, (_, n) => ({
    file: `units/unit${n}.lua`,
    created: false,
    lines: [
      { kind: "removed" as const, oldLine: 1, newLine: null, text: "old" },
      { kind: "added" as const, oldLine: null, newLine: 1, text: "new" },
    ],
  }));
}

/** The message ID Lingui gives a plural whose count variable is `variable`. */
function pluralId(variable: string, one: string, other: string): string {
  return generateMessageId(
    `{${variable}, plural, one {${one}} other {${other}}}`,
  );
}

function fixtureCatalog() {
  const entry = (
    variable: string,
    one: string,
    other: string,
    fr: string[],
  ) => [
    pluralId(variable, one, other),
    compileMessage(`{${variable}, plural, one {${fr[0]}} other {${fr[1]}}}`),
  ];
  return Object.fromEntries([
    entry(
      "count",
      "Put # file back as it was.",
      "Put # files back as they were.",
      ["Fixture: # fichier remis", "Fixture: # fichiers remis"],
    ),
    entry(
      "pending",
      "This deletes the original coilbox kept of # file. After that, undo is not possible here, only through your own copy or version control.",
      "This deletes the originals coilbox kept of # files. After that, undo is not possible here, only through your own copy or version control.",
      ["Fixture: # original gardé", "Fixture: # originaux gardés"],
    ),
  ]);
}

function draw() {
  render(
    <I18nProvider i18n={i18n}>
      <DiskDiffDrawer
        open
        onOpenChange={() => {}}
        gameDir="/spring/games/dev.sdd"
        reading={false}
        onDone={vi.fn()}
      />
    </I18nProvider>,
  );
}

async function openAccept() {
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
}

afterEach(() => {
  cleanup();
  diffsResponse = [];
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the disk diff drawer's plurals", () => {
  it.each([
    [1, "This deletes the original coilbox kept of 1 file."],
    [3, "This deletes the originals coilbox kept of 3 files."],
  ])("says the right English for %i file(s) before accepting", async (count, start) => {
    diffsResponse = files(count);
    draw();
    await openAccept();
    expect(screen.getByText(new RegExp(`^${start}`))).toBeTruthy();
  });

  it.each([
    [1, "Put 1 file back as it was."],
    [3, "Put 3 files back as they were."],
  ])("says the right English after undoing %i file(s)", async (count, sentence) => {
    diffsResponse = files(count);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText(sentence)).toBeTruthy();
  });

  it.each([
    [1, "Fixture: 1 original gardé", "Fixture: 1 fichier remis"],
    [3, "Fixture: 3 originaux gardés", "Fixture: 3 fichiers remis"],
  ])("takes the fixture catalog's plural for %i file(s)", async (count, pending, undone) => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    diffsResponse = files(count);
    draw();
    await openAccept();
    expect(screen.getByText(new RegExp(`^${pending}`))).toBeTruthy();
    expect(screen.queryByText(/This deletes/)).toBeNull();
    // Close the confirm popover's trigger path by undoing from the toolbar.
    fireEvent.keyDown(document.body, { key: "Escape" });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]);
    });
    expect(await screen.findByText(undone)).toBeTruthy();
  });
});
