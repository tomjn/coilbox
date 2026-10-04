// @vitest-environment happy-dom

/**
 * Where a challenge's best result shows up: the line on a run's page, the line
 * under the import box, and the share checkbox that copies it as text.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The frame package's `AppFrame` subpath does not resolve under vitest, so this
// stands in for the two things these components use. `useSetting` reads the
// installed storage and writes through to it, as in `useResultRecords.test.ts`.
vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    useSetting: (key: string, fallback: unknown) => [
      readStoredSetting(key, fallback),
      (next: unknown) => storage.set(key, JSON.stringify(next)),
    ],
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});
vi.mock("@/hub/PublishSection", () => ({ PublishSection: () => null }));

import { decodeConquestChallenge } from "../conquest/challenge";
import {
  installSettingsStorage,
  memorySettingsStorage,
  readStoredSetting,
} from "../lib/storedSetting";
import type { ResultRecord } from "../records/bestResult";
import { ChallengeRecordLine } from "./ChallengeRecordLine";
import { ChallengeShare } from "./ChallengeShare";
import { encodeChallenge } from "./code";
import { ImportedCodeRecord } from "./ImportedCodeRecord";
import { conquestIdentity } from "./identity";
import { CHALLENGE_RECORDS_KEY, type ChallengeBest, shareText } from "./record";

let storage = memorySettingsStorage();

const settings = {
  seed: 4242,
  game: { shortname: "TG" },
  title: "TG Conquest",
  nodeCount: 20,
  factionCount: 2,
  layout: "spiral" as const,
  skin: "theatre" as const,
};
const code = encodeChallenge("conquest", settings);
const identity = conquestIdentity(settings);

const best: ChallengeBest = {
  mode: "conquest",
  won: true,
  measure: 14,
  runId: "g:1",
};
const record: ResultRecord<ChallengeBest> = {
  attempts: 3,
  wins: 1,
  best,
  seen: ["g:1", "g:2", "g:3"],
};

function store(records: Record<string, ResultRecord<ChallengeBest>>) {
  storage.set(CHALLENGE_RECORDS_KEY, JSON.stringify(records));
}

beforeEach(() => {
  storage = memorySettingsStorage();
  installSettingsStorage(storage);
});
afterEach(cleanup);

describe("the line on a run's page", () => {
  it("shows the best result and the attempt count", () => {
    store({ [identity]: record });
    render(<ChallengeRecordLine identity={identity} />);
    expect(
      screen.getByText("Your best: won in 14 turns. 3 attempts."),
    ).toBeTruthy();
  });

  it("shows nothing for a challenge with no record", () => {
    store({ other: record });
    const { container } = render(<ChallengeRecordLine identity={identity} />);
    expect(container.textContent).toBe("");
  });

  it("clears one record only after the confirm", async () => {
    store({ [identity]: record, other: record });
    render(<ChallengeRecordLine identity={identity} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear the record for this challenge",
      }),
    );
    expect(await screen.findByText(/forgets 3 attempts/)).toBeTruthy();
    expect(readStoredSetting(CHALLENGE_RECORDS_KEY, {})).toHaveProperty(
      identity,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear record" }));
    expect(Object.keys(readStoredSetting(CHALLENGE_RECORDS_KEY, {}))).toEqual([
      "other",
    ]);
  });
});

describe("the line under the import box", () => {
  const renderImport = (text: string) =>
    render(
      <ImportedCodeRecord
        code={text}
        decode={decodeConquestChallenge}
        identityOf={conquestIdentity}
      />,
    );

  it("shows your best for the code pasted", () => {
    store({ [identity]: record });
    renderImport(code);
    expect(
      screen.getByText("Your best: won in 14 turns. 3 attempts."),
    ).toBeTruthy();
  });

  it("does not show the sharer's claim from text under the code", () => {
    store({ [identity]: record });
    renderImport(shareText(code, { ...best, measure: 3 }));
    expect(screen.queryByText(/won in 3 turns/)).toBeNull();
    expect(screen.getByText(/won in 14 turns/)).toBeTruthy();
  });

  it("shows nothing for text that is not a code, or a code with no record", () => {
    store({ [identity]: record });
    expect(renderImport("not a code").container.textContent).toBe("");
    cleanup();
    store({});
    expect(renderImport(code).container.textContent).toBe("");
  });
});

describe("the share checkbox", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });
  const renderShare = () =>
    render(<ChallengeShare identity={identity} code={code} helpText="Help" />);

  it("is absent until there is a result to share", () => {
    renderShare();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("is off by default, so copying gives the bare code", async () => {
    store({ [identity]: record });
    renderShare();
    const box = screen.getByRole("checkbox", {
      name: /Include my best result as text/,
    });
    expect(box.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /Copy code/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
  });

  it("adds the result as a claim under the code when ticked", async () => {
    store({ [identity]: record });
    renderShare();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Include my best result as text/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Copy code/ }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${code}\n\nMy best result so far (my claim, not checked by coilbox): won in 14 turns`,
      ),
    );
    // The box itself still holds the bare code.
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      code,
    );
  });
});
