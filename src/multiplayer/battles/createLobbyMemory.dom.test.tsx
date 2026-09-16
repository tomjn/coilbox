// @vitest-environment happy-dom

/**
 * Remembering the last map created (issue #2853, the same treatment issue
 * #2794 gave the TASServer "Host a battle" form). The popover used to start
 * the map back at whichever came first in the scan every time.
 *
 * `usePreferredTarget` and `useUnitsyncScan` are stood in for below so the
 * test can control what the scan returns without driving a real one.
 */

import { PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CreateLobbyArgs, CreateLobbyPopover } from "./CreateLobbyPopover";

vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({ value }: { value: string }) => <span>{value}</span>,
}));

const usePreferredTarget = vi.hoisted(() => vi.fn());
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => usePreferredTarget(),
}));

const useUnitsyncScan = vi.hoisted(() => vi.fn());
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => useUnitsyncScan(),
}));

function stubScan(mapNames: string[]) {
  usePreferredTarget.mockReturnValue({
    target: { enginePath: "/e", dataDir: "/d" },
    loading: false,
    error: null,
  });
  useUnitsyncScan.mockReturnValue({
    data: { maps: mapNames.map((name) => ({ name })) },
    loading: false,
    error: null,
  });
}

function popover(initialMap?: string) {
  const created: CreateLobbyArgs[] = [];
  render(
    <PersistentStoreProvider>
      <CreateLobbyPopover
        disabled={false}
        onCreate={(args) => created.push(args)}
        initialMap={initialMap}
        autoOpen
      />
    </PersistentStoreProvider>,
  );
  return created;
}

function createLobby() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Friday pubs" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create lobby" }));
}

afterEach(cleanup);

beforeEach(() => {
  // A previous test's remembered map would otherwise seed the next.
  localStorage.clear();
});

describe("remembering the last map created", () => {
  it("preselects the map created last time over the scan's first map", () => {
    stubScan(["Zed Map"]);
    const first = popover();
    createLobby();
    expect(first).toHaveLength(1);
    expect(first[0].mapName).toBe("Zed Map");
    cleanup();

    // "Other Map" sorts first in this scan, so a plain reset-to-first-scanned
    // would pick it over what was actually created last time.
    stubScan(["Other Map", "Zed Map"]);
    const second = popover();
    createLobby();
    expect(second[0].mapName).toBe("Zed Map");
  });

  it("lets a jump's initialMap win over the remembered value", () => {
    stubScan(["Zed Map"]);
    const first = popover();
    createLobby();
    expect(first[0].mapName).toBe("Zed Map");
    cleanup();

    stubScan(["DeltaSiegeDry", "Zed Map"]);
    const second = popover("DeltaSiegeDry");
    createLobby();
    expect(second[0].mapName).toBe("DeltaSiegeDry");
  });
});
