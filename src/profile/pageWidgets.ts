import { parseRef } from "./refs";

/**
 * A custom page's body split into rendered segments (issue #274): prose that goes
 * through react-markdown, and `@widget/<name>` tokens that render a live Coilbox
 * component in place. Kept component-free (this `.ts`, vs the `widgets.tsx` registry) so
 * the pure split is unit-testable without loading the widget components.
 */
export type PageSegment =
  | { kind: "text"; text: string }
  | { kind: "widget"; name: string; arg?: string };

/**
 * Split a page body into text/widget segments. A line whose sole content is a
 * `@widget/<name>[/<arg>]` token becomes a widget segment (a mid-sentence `@widget/` ref
 * is left as prose); runs of ordinary lines coalesce into one text segment so markdown
 * blocks (lists, code fences) render intact.
 */
export function splitWidgets(body: string): PageSegment[] {
  const segments: PageSegment[] = [];
  let buffer: string[] = [];
  const flush = () => {
    if (buffer.length > 0) {
      segments.push({ kind: "text", text: buffer.join("\n") });
      buffer = [];
    }
  };
  for (const line of body.split(/\r?\n/)) {
    const ref = parseRef(line.trim());
    if (ref?.kind === "widget") {
      flush();
      segments.push(
        ref.arg
          ? { kind: "widget", name: ref.name, arg: ref.arg }
          : { kind: "widget", name: ref.name },
      );
    } else {
      buffer.push(line);
    }
  }
  flush();
  return segments;
}
