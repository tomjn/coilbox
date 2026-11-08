/**
 * Choose, edit and keep the style the generate screen applies (#3237).
 *
 * The chosen style's fields are edited in place and saved as they change. A
 * style is copied, deleted, saved to a file or loaded from one here too.
 */

import { useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { ask } from "@tauri-apps/plugin-dialog";
import { Copy, Download, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { notify } from "@/notify/notify";

import { freeStyleName, type GeneratorStyle } from "../../generatorStyle";
import {
  loadStyleFromFile,
  saveStyleToFile,
  type useGeneratorStyles,
} from "../../generatorStyles";
import { colourwayLabel, type LoadedPack } from "../../pack";

/** The select's value for "no style" and for "no preference". Not a style id,
 *  a colourway or a shape, since none starts with `@`. */
export const NONE = "@none";

/** The colourways the pack's parts come in, in its category order. */
function colourways(pack: LoadedPack): string[] {
  const used = new Set(pack.parts.map((p) => p.colourway));
  return pack.manifest.categories
    .map((c) => c.id)
    .filter((id) => used.has(id) && id !== "mixed");
}

/** The part shapes the pack has, in the order it first lists them. */
function shapes(pack: LoadedPack): string[] {
  return [...new Set(pack.parts.map((p) => p.shape))];
}

interface Props {
  pack: LoadedPack | null;
  store: ReturnType<typeof useGeneratorStyles>;
  chosen: GeneratorStyle | null;
  onChoose: (id: string | null) => void;
}

export function GeneratorStyleSection({
  pack,
  store,
  chosen,
  onChoose,
}: Props) {
  const { t } = useLingui();
  const { styles, create, copy, update, remove } = store;
  const [nameText, setNameText] = useState(chosen?.name ?? "");
  useEffect(() => setNameText(chosen?.name ?? ""), [chosen?.name]);

  const shapeLabels: Record<string, string> = {
    block: t`Blocks`,
    beam: t`Beams`,
    plate: t`Plates`,
  };
  const colourOptions = useMemo(() => (pack ? colourways(pack) : []), [pack]);
  const shapeOptions = useMemo(() => (pack ? shapes(pack) : []), [pack]);

  function commitName() {
    if (!chosen) return;
    const others = styles.filter((s) => s.id !== chosen.id);
    if (nameText.trim() === "") {
      setNameText(chosen.name);
      return;
    }
    const name = freeStyleName(nameText, others);
    setNameText(name);
    if (name !== chosen.name) update({ ...chosen, name });
  }

  /** The style with one optional field set, or cleared for `NONE`. */
  function withField(
    key: "colourway" | "proportions" | "detail",
    value: string,
  ): GeneratorStyle {
    const next: GeneratorStyle = { ...(chosen as GeneratorStyle) };
    delete next[key];
    return value === NONE
      ? next
      : ({ ...next, [key]: value } as GeneratorStyle);
  }

  async function deleteChosen() {
    if (!chosen) return;
    const name = chosen.name;
    const yes = await ask(
      t`Delete the style "${name}"? This cannot be undone.`,
      {
        title: t`Delete style?`,
        kind: "warning",
      },
    );
    if (!yes) return;
    remove(chosen.id);
    onChoose(null);
  }

  async function load() {
    const loaded = await loadStyleFromFile();
    if (!loaded) return;
    if ("failed" in loaded) {
      void notify(loaded.failed);
      return;
    }
    onChoose(copy(loaded.style));
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-border/60 p-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t`Style`} className="min-w-48 flex-1">
          <OptionSelect
            value={chosen?.id ?? NONE}
            onValueChange={(value) => onChoose(value === NONE ? null : value)}
            options={[
              { value: NONE, label: t`No style` },
              ...styles.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChoose(create())}
        >
          <Plus size={16} /> {t`New style`}
        </Button>
        <Button type="button" variant="outline" onClick={() => void load()}>
          <Upload size={16} /> {t`Load style`}
        </Button>
      </div>

      {chosen ? (
        <>
          <div className="grid grid-cols-2 items-start gap-4">
            <Field label={t`Name`}>
              <Input
                value={nameText}
                onChange={(event) => setNameText(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitName();
                  }
                }}
              />
            </Field>
            <Field label={t`Colour`}>
              <OptionSelect
                value={chosen.colourway ?? NONE}
                onValueChange={(value) => update(withField("colourway", value))}
                options={[
                  { value: NONE, label: t`As generated` },
                  ...colourOptions.map((id) => ({
                    value: id,
                    label: pack ? colourwayLabel(pack, id) : id,
                  })),
                ]}
              />
            </Field>
            <Field label={t`Proportions`}>
              <OptionSelect
                value={chosen.proportions ?? NONE}
                onValueChange={(value) =>
                  update(withField("proportions", value))
                }
                options={[
                  { value: NONE, label: t`As the job rolls them` },
                  { value: "stocky", label: t`Stocky` },
                  { value: "lean", label: t`Lean` },
                ]}
              />
            </Field>
            <Field label={t`Detail`}>
              <OptionSelect
                value={chosen.detail ?? NONE}
                onValueChange={(value) => update(withField("detail", value))}
                options={[
                  { value: NONE, label: t`As the job rolls it` },
                  { value: "sparse", label: t`Sparse` },
                  { value: "dense", label: t`Dense` },
                ]}
              />
            </Field>
            <fieldset className="col-span-2 flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">
                {t`Preferred shapes`}
              </legend>
              <div className="flex flex-wrap gap-4">
                {shapeOptions.map((shape) => (
                  <CheckField
                    key={shape}
                    label={shapeLabels[shape] ?? shape}
                    checked={chosen.shapes.includes(shape)}
                    onChange={(on) =>
                      update({
                        ...chosen,
                        shapes: on
                          ? [...chosen.shapes, shape]
                          : chosen.shapes.filter((s) => s !== shape),
                      })
                    }
                  />
                ))}
              </div>
            </fieldset>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onChoose(copy(chosen))}
            >
              <Copy size={16} /> {t`Copy`}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void saveStyleToFile(chosen).then((out) => out && notify(out))
              }
            >
              <Download size={16} /> {t`Save to file`}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void deleteChosen()}
            >
              <Trash2 size={16} /> {t`Delete`}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
