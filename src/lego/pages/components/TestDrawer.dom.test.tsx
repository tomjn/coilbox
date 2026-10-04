// @vitest-environment happy-dom

/**
 * The unit builder's test drawer when the content scan failed (issue #3423).
 * unitsync's `Init` failing leaves no game or map list because the engine could
 * not start, so the drawer gives the engine's reason, claims nothing is
 * installed, and keeps Launch off.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const REASON = "no space left on device";

vi.mock("@picoframe/frame", async (importOriginal) => {
  const react = await import("react");
  return {
    ...(await importOriginal<object>()),
    useSetting: <T,>(_key: string, initial: T) => react.useState<T>(initial),
  };
});

vi.mock("../../../content/config", () => ({
  primeScan: vi.fn(),
  useUnitsyncGameHeaders: () => ({ headers: new Map() }),
  useUnitsyncScan: () => ({
    data: null,
    unvouched: null,
    error: REASON,
    loading: false,
    cancelled: false,
    run: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("../../../play/config", () => ({
  gameOptionSchema: vi.fn(),
  initialParticipants: () => [{}],
  mapOptionSchema: vi.fn(),
  toBattleConfig: vi.fn(),
  usePreferredTarget: () => ({
    target: {
      enginePath: "/engine",
      dataDir: "/data",
      executable: "/engine/spring",
    },
    loading: false,
  }),
}));

vi.mock("../../../play/PlayProvider", () => ({
  usePlay: () => ({ running: false, launch: vi.fn() }),
}));

vi.mock("../../bindings", () => ({
  legoExport: vi.fn(),
  legoScratchGame: vi.fn(),
}));

import { newProject } from "../../model";
import type { LoadedPack } from "../../pack";
import { TestDrawer } from "./TestDrawer";

afterEach(cleanup);

describe("TestDrawer when the content scan failed", () => {
  it("shows the reason, claims nothing is installed, and keeps Launch off", () => {
    render(
      <TestDrawer
        open
        onOpenChange={() => {}}
        project={newProject({
          id: "p1",
          rootPieceId: "root",
          name: "Skyfort",
          packId: "base",
          packVersion: "1",
          now: "",
        })}
        pack={{} as LoadedPack}
        raw={null}
      />,
    );

    expect(screen.getByText(`The content scan failed: ${REASON}`)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Launch/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(document.body.textContent).not.toMatch(
      /No game is installed|No map is installed|not installed|No game installed|No map installed|Download/,
    );
  });
});
