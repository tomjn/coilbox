// @vitest-environment happy-dom

/**
 * The composition Settings > Coilbox hub and the hub page's Share menu now
 * both use (issue #2562): signing in, the switch, and the four sweep controls,
 * wired to the same `agreed` state and gated the same way.
 *
 * Each control's own behaviour lives in its own test (e.g.
 * `GamePicturesControl.dom.test.tsx`, `MapPicturesControl.dom.test.tsx`). This
 * covers the wiring: that turning the switch on is what reveals the four
 * controls, that they all get the panel's hub url, and that a distribution
 * that switched sharing off entirely says so instead of offering a switch that
 * would only be refused.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let offered = true;
vi.mock("../../../profile/profile", () => ({
  isHubAssetUploadOffered: () => offered,
}));

// The real hook writes to the settings store on disk. The switch only needs
// state that actually changes when pressed, so this keeps it in React state
// instead.
vi.mock("../../assetUploads", async () => {
  const React = await import("react");
  return {
    useAssetUploadConsent: (): [boolean, (next: boolean) => Promise<void>] => {
      const [agreed, setAgreed] = React.useState(false);
      return [
        agreed,
        async (next: boolean) => {
          setAgreed(next);
        },
      ];
    },
  };
});

vi.mock("../../account", () => ({
  useHubAccount: () => ({
    loading: false,
    busy: false,
    signedIn: true,
    unknown: false,
    account: { id: "1", name: "Someone", avatarUrl: null },
    problem: null,
    recheck: async () => {},
    signIn: async () => {},
    signOut: async () => {},
  }),
}));

// Each of the four reads real engine data through `usePreferredTarget` and
// runs a real sweep. Neither belongs to this test, which is only about
// whether these four are shown, and with what hub url. Each stub honours
// `agreed` the same way its real component does (own test: "offers nothing
// until sending pictures has been agreed to"), since the panel itself does
// not gate on it - each control does.
type ControlProps = { hubUrl: string; agreed: boolean };
vi.mock("./MapCatalogControl", () => ({
  MapCatalogControl: ({ hubUrl, agreed }: ControlProps) =>
    agreed ? <div data-testid="map-catalog">{hubUrl}</div> : null,
}));
vi.mock("./MapPicturesControl", () => ({
  MapPicturesControl: ({ hubUrl, agreed }: ControlProps) =>
    agreed ? <div data-testid="map-pictures">{hubUrl}</div> : null,
}));
vi.mock("./GameFactsControl", () => ({
  GameFactsControl: ({ hubUrl, agreed }: ControlProps) =>
    agreed ? <div data-testid="game-facts">{hubUrl}</div> : null,
}));
vi.mock("./GamePicturesControl", () => ({
  GamePicturesControl: ({ hubUrl, agreed }: ControlProps) =>
    agreed ? <div data-testid="game-pictures">{hubUrl}</div> : null,
}));

import { ShareAssetsPanel } from "./ShareAssetsPanel";

const FOUR = ["map-catalog", "map-pictures", "game-facts", "game-pictures"];

beforeEach(() => {
  offered = true;
});

afterEach(cleanup);

it("signs in before offering the switch", () => {
  render(<ShareAssetsPanel hubUrl="https://hub.example" />);

  expect(screen.getByText("Signed in as Someone.")).toBeTruthy();
});

it("hides the four controls until sharing is agreed to", () => {
  render(<ShareAssetsPanel hubUrl="https://hub.example" />);

  for (const id of FOUR) expect(screen.queryByTestId(id)).toBeNull();

  fireEvent.click(screen.getByRole("switch"));

  for (const id of FOUR) expect(screen.getByTestId(id)).toBeTruthy();
});

it("hands every control the panel's own hub url", () => {
  render(<ShareAssetsPanel hubUrl="https://hub.example" />);

  fireEvent.click(screen.getByRole("switch"));

  for (const id of FOUR) {
    expect(screen.getByTestId(id).textContent).toBe("https://hub.example");
  }
});

it("says a distribution switched sharing off, rather than offering a switch that can only be refused", () => {
  offered = false;
  render(<ShareAssetsPanel hubUrl="https://hub.example" />);

  expect(screen.queryByRole("switch")).toBeNull();
  expect(
    screen.getByText(/distribution has switched off sending pictures/i),
  ).toBeTruthy();
  for (const id of FOUR) expect(screen.queryByTestId(id)).toBeNull();
});
