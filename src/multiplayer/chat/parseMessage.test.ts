import { describe, expect, it } from "vitest";
import { parseMessage } from "./parseMessage";

describe("parseMessage", () => {
  it("returns a single text token for plain text", () => {
    expect(parseMessage("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("highlights only a leading command token", () => {
    expect(parseMessage("!start now")).toEqual([
      { type: "command", value: "!start" },
      { type: "text", value: " now" },
    ]);
  });

  it("does not treat a mid-text ! as a command", () => {
    expect(parseMessage("no way !nope")).toEqual([
      { type: "text", value: "no way !nope" },
    ]);
  });

  it("parses inline code and ignores markers inside it", () => {
    expect(parseMessage("run `!foo *bar*` please")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "!foo *bar*" },
      { type: "text", value: " please" },
    ]);
  });

  it("leaves an unclosed backtick as literal text", () => {
    expect(parseMessage("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
  });

  it("keeps a plain multi-line message as one text token", () => {
    expect(parseMessage("one\ntwo\nthree")).toEqual([
      { type: "text", value: "one\ntwo\nthree" },
    ]);
  });

  it("parses a fenced block with a lang tag", () => {
    expect(parseMessage("```js\nlet a = 1;\n```")).toEqual([
      { type: "codeblock", value: "let a = 1;", lang: "js" },
    ]);
  });

  it("parses a fenced block without a lang tag", () => {
    expect(parseMessage("```\nplain\n```")).toEqual([
      { type: "codeblock", value: "plain" },
    ]);
  });

  it("keeps the text either side of a fence", () => {
    expect(parseMessage("try\n```\nfoo\n```\nthen go")).toEqual([
      { type: "text", value: "try\n" },
      { type: "codeblock", value: "foo" },
      { type: "text", value: "\nthen go" },
    ]);
  });

  it("keeps a fence's own markers out of the block, formatting included", () => {
    expect(parseMessage("```\n*not bold* `not code`\n```")).toEqual([
      { type: "codeblock", value: "*not bold* `not code`" },
    ]);
  });

  it("does not let a fence swallow the prose between two of them", () => {
    expect(parseMessage("```\na\n```mid```\nb\n```")).toEqual([
      { type: "codeblock", value: "a" },
      { type: "text", value: "mid" },
      { type: "codeblock", value: "b" },
    ]);
  });

  it("leaves an unterminated fence as literal text", () => {
    expect(parseMessage("```js\nlet a = 1;")).toEqual([
      { type: "text", value: "```js\nlet a = 1;" },
    ]);
  });

  it("parses inline code alongside a fence", () => {
    expect(parseMessage("run `x` in\n```\ny\n```")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "x" },
      { type: "text", value: " in\n" },
      { type: "codeblock", value: "y" },
    ]);
  });

  it("parses a fence after a leading command", () => {
    expect(parseMessage("!help\n```\nx\n```")).toEqual([
      { type: "command", value: "!help" },
      { type: "text", value: "\n" },
      { type: "codeblock", value: "x" },
    ]);
  });

  it("auto-links a bare URL", () => {
    expect(parseMessage("see https://example.com yo")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " yo" },
    ]);
  });

  it("trims trailing sentence punctuation off a URL", () => {
    expect(parseMessage("go https://example.com.")).toEqual([
      { type: "text", value: "go " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("parses bold and both italic markers, stripping the markers", () => {
    expect(parseMessage("a **b** c *d* e _f_")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c " },
      { type: "italic", children: [{ type: "text", value: "d" }] },
      { type: "text", value: " e " },
      { type: "italic", children: [{ type: "text", value: "f" }] },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(parseMessage("**_x_**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "italic", children: [{ type: "text", value: "x" }] },
        ],
      },
    ]);
  });

  it("leaves a lone asterisk as literal text", () => {
    expect(parseMessage("2 * 3")).toEqual([{ type: "text", value: "2 * 3" }]);
  });

  it("wraps a leading > line in a quote token", () => {
    expect(parseMessage("> hello")).toEqual([
      { type: "quote", children: [{ type: "text", value: "hello" }] },
    ]);
  });

  it("keeps inline formatting inside a quote", () => {
    expect(parseMessage("> a **b**")).toEqual([
      {
        type: "quote",
        children: [
          { type: "text", value: "a " },
          { type: "bold", children: [{ type: "text", value: "b" }] },
        ],
      },
    ]);
  });

  it("does not treat a mid-line > as a quote", () => {
    expect(parseMessage("2 > 1")).toEqual([{ type: "text", value: "2 > 1" }]);
  });

  it("groups consecutive quote lines into one quote token", () => {
    expect(parseMessage("> one\n> two")).toEqual([
      {
        type: "quote",
        children: [{ type: "text", value: "one\ntwo" }],
      },
    ]);
  });

  it("tokenizes a leading @mention", () => {
    expect(parseMessage("@bob hi")).toEqual([
      { type: "mention", value: "bob" },
      { type: "text", value: " hi" },
    ]);
  });

  it("tokenizes an @mention after text", () => {
    expect(parseMessage("hey @bob")).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", value: "bob" },
    ]);
  });

  it("keeps clan-tag characters in a mention", () => {
    expect(parseMessage("@[ABC]bob go")).toEqual([
      { type: "mention", value: "[ABC]bob" },
      { type: "text", value: " go" },
    ]);
  });

  it("does not treat an email local part as a mention", () => {
    expect(parseMessage("mail a@b.com")).toEqual([
      { type: "text", value: "mail a@b.com" },
    ]);
  });

  it("parses a mention inside bold", () => {
    expect(parseMessage("**@bob**")).toEqual([
      { type: "bold", children: [{ type: "mention", value: "bob" }] },
    ]);
  });

  it("tokenizes ~~strikethrough~~", () => {
    expect(parseMessage("~~gone~~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
  });

  it("tokenizes Slack's single-tilde strikethrough", () => {
    expect(parseMessage("~gone~")).toEqual([
      { type: "strike", children: [{ type: "text", value: "gone" }] },
    ]);
  });

  it("parses bold inside strikethrough", () => {
    expect(parseMessage("~~a **b**~~")).toEqual([
      {
        type: "strike",
        children: [
          { type: "text", value: "a " },
          { type: "bold", children: [{ type: "text", value: "b" }] },
        ],
      },
    ]);
  });

  it("leaves a lone tilde as text", () => {
    expect(parseMessage("~/coilbox")).toEqual([
      { type: "text", value: "~/coilbox" },
    ]);
  });

  it("tokenizes ***x*** as bold and italic at once", () => {
    expect(parseMessage("***loud***")).toEqual([
      {
        type: "bold",
        children: [
          { type: "italic", children: [{ type: "text", value: "loud" }] },
        ],
      },
    ]);
  });

  it("keeps bold and italic apart from bold-italic", () => {
    expect(parseMessage("**b** *i*")).toEqual([
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " " },
      { type: "italic", children: [{ type: "text", value: "i" }] },
    ]);
  });
});

describe("parseMessage lists", () => {
  const item = (value: string) => [{ type: "text", value }];

  it("groups consecutive bullet lines into one list", () => {
    expect(parseMessage("- first\n- second")).toEqual([
      { type: "list", items: [item("first"), item("second")] },
    ]);
  });

  it("takes + and * as bullets too", () => {
    expect(parseMessage("+ first\n+ second")).toEqual([
      { type: "list", items: [item("first"), item("second")] },
    ]);
    expect(parseMessage("* first\n* second")).toEqual([
      { type: "list", items: [item("first"), item("second")] },
    ]);
  });

  it("reads a run of mixed markers as one list", () => {
    expect(parseMessage("- first\n+ second\n* third")).toEqual([
      { type: "list", items: [item("first"), item("second"), item("third")] },
    ]);
  });

  it("does not mistake italic for a bullet", () => {
    // The space after the marker is what keeps `*` usable as a bullet at all.
    expect(parseMessage("*first*\n*second*")).toEqual([
      { type: "italic", children: [{ type: "text", value: "first" }] },
      { type: "text", value: "\n" },
      { type: "italic", children: [{ type: "text", value: "second" }] },
    ]);
  });

  it("takes an indented bullet", () => {
    expect(parseMessage(" - first\n   - second")).toEqual([
      { type: "list", items: [item("first"), item("second")] },
    ]);
  });

  it("leaves a lone bullet line as text", () => {
    // People start a line with a dash all the time; one is not a list.
    expect(parseMessage("- yeah, that")).toEqual([
      { type: "text", value: "- yeah, that" },
    ]);
  });

  it("leaves separated bullet lines as text", () => {
    expect(parseMessage("- one\nnope\n- two")).toEqual([
      { type: "text", value: "- one\nnope\n- two" },
    ]);
  });

  it("does not treat a mid-line dash as a bullet", () => {
    expect(parseMessage("a - b\nc - d")).toEqual([
      { type: "text", value: "a - b\nc - d" },
    ]);
  });

  it("needs a space after the dash", () => {
    expect(parseMessage("-1\n-2")).toEqual([{ type: "text", value: "-1\n-2" }]);
  });

  it("parses inline formatting inside an item", () => {
    expect(parseMessage("- **a**\n- @bob")).toEqual([
      {
        type: "list",
        items: [
          [{ type: "bold", children: [{ type: "text", value: "a" }] }],
          [{ type: "mention", value: "bob" }],
        ],
      },
    ]);
  });

  it("keeps the text around a list", () => {
    expect(parseMessage("todo:\n- one\n- two\ndone")).toEqual([
      { type: "text", value: "todo:" },
      { type: "list", items: [item("one"), item("two")] },
      { type: "text", value: "done" },
    ]);
  });

  it("reads a quoted dash as a quote, not a list", () => {
    expect(parseMessage("> - one\n> - two")).toEqual([
      { type: "quote", children: [{ type: "text", value: "- one\n- two" }] },
    ]);
  });

  it("separates a list from an adjacent quote", () => {
    expect(parseMessage("> said\n- one\n- two")).toEqual([
      { type: "quote", children: [{ type: "text", value: "said" }] },
      { type: "list", items: [item("one"), item("two")] },
    ]);
  });
});
