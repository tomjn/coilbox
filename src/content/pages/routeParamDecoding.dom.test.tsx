// @vitest-environment happy-dom
/**
 * What the router hands a detail page for a name built the way every link
 * builds it (`encodeURIComponent` once). The pages must use that value as it
 * comes, with no second decode (#3422).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { HashRouter, Link, Route, Routes, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

const NAMES = [
  "%",
  "%25",
  "50% done.sdfz",
  "a#b",
  "a?b",
  "a/b",
  "a b",
  "a+b",
  "Ünïcode 名前.sdfz",
];

function Probe() {
  const { name } = useParams();
  return <div data-testid="param">{name}</div>;
}

afterEach(() => {
  cleanup();
  window.location.hash = "";
});

describe("route parameters under the hash router", () => {
  it.each(NAMES)("hands back %j exactly once decoded", (name) => {
    window.location.hash = `#/play/replays/${encodeURIComponent(name)}`;
    render(
      <HashRouter>
        <Routes>
          <Route path="play/replays/:name" element={<Probe />} />
        </Routes>
        <Link to="/x">x</Link>
      </HashRouter>,
    );
    expect(screen.getByTestId("param").textContent).toBe(name);
  });
});
