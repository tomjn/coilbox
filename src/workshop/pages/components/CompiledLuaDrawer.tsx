/**
 * The project as Lua, where the user can read it (issue #1275).
 *
 * A tweak tool that only shows you the result is a tool you have to trust. The
 * game reads Lua in the end, most of the people using this have read a
 * `units/*.lua` before, and the fastest way to find out whether coilbox
 * understood what you meant is to look at what it wrote.
 *
 * Two things on screen rather than one. The files are what would be written
 * into the generated game, and they are the thing to read. Above them is the
 * decision the compiler made for each change and why, because the choice
 * between a plain table and a `do ... end` block is the part that is not
 * obvious from the Lua itself: a build menu written out as a list looks fine
 * and quietly freezes that factory's roster at today's game.
 *
 * Read only on purpose. Editing the generated Lua would mean the project and
 * its output could disagree, and the project is the document.
 *
 * A project can also carry Lua that is read only for a different reason
 * (issue #1280): recovered from a decoded tweak set that turned out to be a
 * program rather than data, so there was never a safe way to turn it into
 * one of the five editable stores. That Lua is shown here too, in its own
 * section, and never inside "generated": nothing here compiled it and
 * nothing here runs it. `compiled.notes` already says how many blocks there
 * are and why. This is where the actual Lua behind that count is.
 */
import { Drawer } from "@picoframe/frame";
import { CodeBlock } from "@/components/CodeBlock";
import type { CompiledChunk, CompileState } from "../../compile";
import type { ModProject } from "../../project";

/** What each form is, in the fewest words that distinguish them. */
const FORM_LABEL: Record<CompiledChunk["form"], string> = {
  table: "Table",
  block: "do ... end",
};

export function CompiledLuaDrawer({
  open,
  onOpenChange,
  project,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ModProject;
  state: CompileState;
}) {
  const { compiled, loading, error } = state;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Generated Lua"
      description={`What ${project.name} compiles to on top of ${project.gameName}. Built from the project every time it is opened, so there is nothing here to save.`}
      width="48rem"
    >
      <div className="flex flex-col gap-5">
        {loading && <p className="text-muted-foreground text-sm">Compiling…</p>}

        {error && (
          <p className="text-destructive text-sm">
            The compiler could not run: {error}
          </p>
        )}

        {compiled && compiled.notes.length > 0 && (
          <section className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/40 p-3">
            <h3 className="font-medium text-sm">Worth knowing</h3>
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-muted-foreground text-xs">
              {compiled.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        )}

        {compiled && compiled.chunks.length === 0 && !loading && (
          <p className="text-muted-foreground text-sm">
            This project changes nothing yet, so there is nothing to compile.
          </p>
        )}

        {compiled && compiled.chunks.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="font-medium text-sm">What the compiler chose</h3>
            <ul className="flex flex-col gap-2">
              {compiled.chunks.map((chunk) => (
                <li
                  key={`${chunk.form}:${chunk.title}`}
                  className="flex items-baseline gap-2 text-xs"
                >
                  <span className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                    {FORM_LABEL[chunk.form]}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{chunk.title}</span>{" "}
                    <span className="text-muted-foreground">
                      {chunk.reason}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {compiled?.files.map((file) => (
          <section key={file.path} className="flex min-w-0 flex-col gap-1.5">
            <h3 className="font-mono text-muted-foreground text-xs">
              {file.path}
            </h3>
            <CodeBlock
              code={file.contents}
              lang="lua"
              label={`${file.path} as Lua`}
              className="max-h-96 rounded-lg border border-border/50"
            />
          </section>
        ))}

        {project.readOnlyLua && project.readOnlyLua.length > 0 && (
          <section className="flex flex-col gap-3 border-border/60 border-t pt-4">
            <h3 className="font-medium text-sm">
              Read only ({project.readOnlyLua.length})
            </h3>
            <p className="text-muted-foreground text-xs">
              Recovered from a decoded import that turned out to be a program
              rather than data. Shown for reference only: nothing above compiles
              or runs it.
            </p>
            {project.readOnlyLua.map((block, index) => (
              <div
                // Stable for one open project: nothing here reorders.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={index}
                className="flex min-w-0 flex-col gap-1.5"
              >
                <h4 className="font-mono text-muted-foreground text-xs">
                  {block.title}
                </h4>
                <p className="text-muted-foreground text-xs">{block.note}</p>
                <CodeBlock
                  code={block.lua}
                  lang="lua"
                  label={`${block.title} as Lua, read only`}
                  className="max-h-96 rounded-lg border border-border/50"
                />
              </div>
            ))}
          </section>
        )}
      </div>
    </Drawer>
  );
}
