// @vitest-environment happy-dom

/**
 * Remembering the last battle hosted on Zero-K (issue #2853, the same
 * treatment issue #2794 gave the TASServer "Host a battle" form). The
 * popover used to start the title, map and player limit from scratch every
 * time.
 *
 * `usePreferredTarget` and `useUnitsyncScan` are stood in for below so the
 * test can control what the scan returns without driving a real one.
 */

import { PersistentStoreProvider } from "@picoframe/frame";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HostZerokBattlePopover,
  type ZerokOpenBattleArgs,
} from "./HostZerokBattlePopover";

// A real `<select>` rather than a dumb span, so a map can actually be picked
// (issue #2853 needs a map hosted last time to differ from whatever the scan
// would otherwise default to).
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
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

function popover(props: { initialMap?: string; initialTitle?: string } = {}) {
  const hosted: ZerokOpenBattleArgs[] = [];
  render(
    <PersistentStoreProvider>
      <HostZerokBattlePopover
        disabled={false}
        onHost={async (args) => {
          hosted.push(args);
        }}
        autoOpen
        {...props}
      />
    </PersistentStoreProvider>,
  );
  return hosted;
}

async function hostBattle(hosted: ZerokOpenBattleArgs[]) {
  fireEvent.click(screen.getByRole("button", { name: "Host battle" }));
  await vi.waitFor(() => expect(hosted).toHaveLength(1));
}

afterEach(cleanup);

beforeEach(() => {
  // A previous test's remembered battle would otherwise seed the next.
  localStorage.clear();
});

describe("remembering the last battle hosted on Zero-K", () => {
  it("preselects the title, map and max players hosted last time", async () => {
    stubScan(["Zed Map"]);
    const first = popover();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Friday night pubs" },
    });
    fireEvent.change(screen.getByLabelText("Map"), {
      target: { value: "Zed Map" },
    });
    fireEvent.change(screen.getByLabelText("Max players"), {
      target: { value: "12" },
    });
    await hostBattle(first);
    expect(first[0]).toMatchObject({
      title: "Friday night pubs",
      map: "Zed Map",
      maxPlayers: 12,
    });
    cleanup();

    // "Other Map" sorts first in this scan, so a plain reset-to-first-scanned
    // map would pick it over what was actually hosted last time.
    stubScan(["Other Map", "Zed Map"]);
    const second = popover();
    await hostBattle(second);
    expect(second[0]).toMatchObject({
      title: "Friday night pubs",
      map: "Zed Map",
      maxPlayers: 12,
    });
  });

  it("lets a jump's initialMap and initialTitle win over the remembered values", async () => {
    stubScan(["Zed Map"]);
    const first = popover();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Friday night pubs" },
    });
    fireEvent.change(screen.getByLabelText("Map"), {
      target: { value: "Zed Map" },
    });
    await hostBattle(first);
    expect(first[0].title).toBe("Friday night pubs");
    expect(first[0].map).toBe("Zed Map");
    cleanup();

    stubScan(["DeltaSiegeDry", "Zed Map"]);
    const second = popover({
      initialMap: "DeltaSiegeDry",
      initialTitle: "Draft night",
    });
    await hostBattle(second);
    expect(second[0].title).toBe("Draft night");
    expect(second[0].map).toBe("DeltaSiegeDry");
  });

  it("does not remember the password", async () => {
    stubScan(["Zed Map"]);
    const first = popover();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Locked room" },
    });
    fireEvent.change(screen.getByLabelText("Password (optional)"), {
      target: { value: "hunter2" },
    });
    await hostBattle(first);
    cleanup();

    stubScan(["Zed Map"]);
    popover();
    expect(
      (screen.getByLabelText("Password (optional)") as HTMLInputElement).value,
    ).toBe("");
  });
});
