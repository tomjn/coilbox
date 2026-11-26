// @vitest-environment happy-dom

/**
 * The sharing switch writes its answer to disk, where the Rust side reads it
 * before any upload. A write that failed used to be an unhandled rejection,
 * with the switch saying one thing and the gate on disk another.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AssetUploadControl } from "./AssetUploadControl";

afterEach(cleanup);

it("says so when the answer could not be saved", async () => {
  render(
    <ul>
      <AssetUploadControl
        agreed={false}
        offered
        onChange={async () => {
          throw new Error("the settings file is read only");
        }}
      />
    </ul>,
  );

  fireEvent.click(screen.getByRole("switch"));

  expect((await screen.findByRole("alert")).textContent).toContain(
    "the settings file is read only",
  );
});

it("keeps the warning beside the switch", () => {
  render(
    <ul>
      <AssetUploadControl agreed={false} offered onChange={() => {}} />
    </ul>,
  );

  expect(screen.getByText(/public and hard to take back/)).toBeTruthy();
});
