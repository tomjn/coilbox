// @vitest-environment happy-dom
/**
 * Issue #4604: the challenge record line and the blueprint source labels come
 * out of the Lingui catalog. The catalog here is a fixture, not a real
 * translation. It renames a few strings so a translated one can be told from
 * the English source.
 */
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@picoframe/frame", async () => {
  const { forwardRef } = await import("react");
  return {
    Button: forwardRef<HTMLButtonElement, Record<string, unknown>>(
      ({ variant: _v, size: _s, ...props }, ref) => (
        <button ref={ref} type="button" {...props} />
      ),
    ),
  };
});
vi.mock("./useChallengeRecords", () => ({
  useChallengeRecords: () => ({
    records: {
      one: {
        attempts: 3,
        best: { result: "won", score: 10, at: "2026-01-01T00:00:00Z" },
      },
    },
    clear: vi.fn(),
  }),
}));

import { sourceLabel } from "../blueprint/library";
import { ChallengeRecordLine } from "./ChallengeRecordLine";

function fixtureCatalog() {
  return {
    [msg`Clear the record for this challenge`.id]: "Fixture clear record",
    [msg`From a shared code`.id]: "Fixture from a code",
  };
}

afterEach(() => {
  cleanup();
  i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("the challenge record line", () => {
  it("shows the fixture catalog's button label", () => {
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    render(
      <I18nProvider i18n={i18n}>
        <ChallengeRecordLine identity="one" />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", { name: "Fixture clear record" }),
    ).toBeTruthy();
  });

  it("stays in English when the catalog has no translation", () => {
    render(
      <I18nProvider i18n={i18n}>
        <ChallengeRecordLine identity="one" />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("button", {
        name: "Clear the record for this challenge",
      }),
    ).toBeTruthy();
  });
});

describe("blueprint source labels", () => {
  it("read the active catalog when called", () => {
    expect(sourceLabel({ kind: "code" } as never)).toBe("From a shared code");
    i18n.loadAndActivate({ locale: "fr", messages: fixtureCatalog() });
    expect(sourceLabel({ kind: "code" } as never)).toBe("Fixture from a code");
  });
});
