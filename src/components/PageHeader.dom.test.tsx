// @vitest-environment happy-dom

/**
 * What a page header renders and in what order (issue #1509).
 *
 * The point of the component is that the description is a sibling of the title
 * row rather than a child of it, so the two tests that matter are "the actions
 * are in the title row" and "the description is not". happy-dom does no layout,
 * so nothing here can say the description is full width or that the buttons
 * drop below the title on a narrow window. That is what the screenshots on the
 * pull request are for.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
  it("puts the description under the title row, not inside it", () => {
    render(
      <PageHeader
        title="Base blueprints"
        description="Blueprints of buildings you can put down anywhere."
        actions={<button type="button">New blueprint</button>}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Base blueprints" });
    const description = screen.getByText(
      "Blueprints of buildings you can put down anywhere.",
    );
    const button = screen.getByRole("button", { name: "New blueprint" });

    const titleRow = heading.parentElement;
    expect(titleRow?.contains(button)).toBe(true);
    expect(titleRow?.contains(description)).toBe(false);
    expect(description.parentElement?.tagName).toBe("HEADER");
  });

  it("renders title, description and children in that order", () => {
    const { container } = render(
      <PageHeader title="Maps" description="Every map you have.">
        <div data-testid="filters">filters</div>
      </PageHeader>,
    );

    const header = container.querySelector("header");
    const order = [...(header?.children ?? [])].map((child) =>
      child.textContent?.trim(),
    );
    expect(order).toEqual(["Maps", "Every map you have.", "filters"]);
  });

  it("leaves the title row to itself when there are no actions", () => {
    const { container } = render(
      <PageHeader title="Maps" description="Every map you have." />,
    );

    const titleRow = container.querySelector("header > div");
    expect(titleRow?.children).toHaveLength(1);
  });

  it("treats a falsy actions value as no actions", () => {
    const hasGames = false;
    const { container } = render(
      <PageHeader
        title="Warpath"
        actions={hasGames && <button type="button">New warpath</button>}
      />,
    );

    expect(container.querySelector("header > div")?.children).toHaveLength(1);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps a page's own header classes, e.g. the bordered strip", () => {
    const { container } = render(
      <PageHeader
        title="Compile"
        className="border-b border-border px-6 py-4"
      />,
    );

    expect(container.querySelector("header")?.className).toContain(
      "border-b border-border px-6 py-4",
    );
  });

  it("takes a node title so a page can put an icon beside the words", () => {
    render(
      <PageHeader
        title={
          <>
            <svg data-testid="rocket" aria-hidden />
            Warpath
          </>
        }
      />,
    );

    const heading = screen.getByRole("heading", { name: "Warpath" });
    expect(heading.querySelector("[data-testid='rocket']")).not.toBeNull();
  });
});
