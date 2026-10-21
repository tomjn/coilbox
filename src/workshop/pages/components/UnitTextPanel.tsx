/**
 * What a unit is called and what its tooltip says (issue #2650).
 *
 * First on the page, above the numbers, because it is the first edit anyone
 * makes and the only one a player reads in words. Its own panel rather than two
 * more rows in the field list, because for a game like Beyond All Reason there
 * is no field: the name is not in the unit definition and the edit does not go
 * there either. `unitText.ts` holds that argument in full.
 *
 * The panel says where the edit lands. A modder who renames a BAR unit is
 * editing the game's localisation file, and that is worth knowing before they
 * wonder why their tweak did not survive a translation update.
 *
 * States are the field list's, so the page reads the same either way: the
 * inherited value greyed, an edited value in the foreground with what it
 * replaced underneath it, and a reset button that removes the edit rather than
 * writing the old value back over it.
 *
 * A game shipping more than one translation gets a tab per language (issue
 * #2672). A game shipping one gets no tabs, because a picker with a single entry
 * is a control that cannot be used.
 *
 * The panel is a {@link SectionPanel}, so it matches the field sections under it
 * (issue #2700). It starts open, unlike the build menu beside it: it is two rows
 * tall whatever the unit, it is the first edit most people make, and shutting it
 * would save a reader nothing. The file the words land in moves to the summary,
 * where a shut panel would still say it, and the sentence explaining why keeps
 * its place above the boxes.
 */
import { Trans, useLingui } from "@lingui/react/macro";
import { Button, cn, Input } from "@picoframe/frame";
import { RotateCcw, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { SectionPanel } from "@/components/SectionPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  languageUnitsFile,
  type TextField,
  type TextHome,
  type UnitTextRow,
} from "../../unitText";

/**
 * A box that reports its edit once it settles, on blur or on Enter, and drops a
 * half-typed value on Escape. The field list's boxes behave the same way, and
 * for the same reason: committing every keystroke would record "Comm" and
 * "Comman" on the way to "Commander".
 */
function SettlingText({
  value,
  multiline,
  label,
  muted,
  placeholder,
  onCommit,
}: {
  value: string;
  multiline: boolean;
  label: string;
  muted: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  // Follows the value when it changes from outside, which is what a reset and a
  // move to another unit both are.
  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setDraft(value);
    if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      commit();
    }
  };
  const className = cn("text-sm", muted && "text-muted-foreground");

  return multiline ? (
    <Textarea
      value={draft}
      aria-label={label}
      rows={2}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      className={cn(className, "min-h-0 py-1.5")}
    />
  ) : (
    <Input
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={keys}
      className={cn(className, "h-8")}
    />
  );
}

/**
 * A language's own name, in that language, as the browser knows it.
 *
 * `Intl.DisplayNames` for the same reason the field list uses the game's own
 * spelling of a movement class: the list is the game's, not ours, and a game is
 * free to ship a locale nothing here has heard of. A code it cannot name is
 * shown as the code, which is what the folder is called anyway.
 */
function languageLabel(code: string): string {
  try {
    return new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function TextRow({
  row,
  label,
  hint,
  multiline,
  placeholder,
  onChange,
  onReset,
}: {
  row: UnitTextRow;
  label: string;
  hint: string;
  multiline: boolean;
  placeholder: string;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const { t } = useLingui();
  const overridden = row.state === "overridden";
  const redirect = row.redirect;
  const inherited = row.inherited;
  // A def that redirects its lookup at another unit reads that unit's entries,
  // so this unit's own keys are ones the game never asks for. Shown rather than
  // hidden, because "where does this name come from" is the question, but not
  // offered for editing when editing it would change nothing.
  if (row.redirect)
    return (
      <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-start gap-3 rounded-md py-1.5 pl-2 pr-1">
        <div className="flex min-w-0 flex-col gap-0.5 pt-1.5">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground">{hint}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5">
          {/* Read only rather than disabled, so it can still be focused and
              read out, and so the value can be copied. */}
          <Input
            value={row.value}
            aria-label={label}
            readOnly
            className="h-8 text-sm text-muted-foreground"
          />
          <span className="text-[10px] text-muted-foreground">
            <Trans>
              Taken from {redirect}, which this unit's definition names as its
              i18nfromunit. Rename {redirect} to change it.
            </Trans>
          </span>
        </div>
        <span className="size-7" />
      </div>
    );
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] items-start gap-3 rounded-md py-1.5 pl-2 pr-1",
        overridden && "bg-primary/5",
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5 pt-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          {label}
          {overridden && (
            <span
              className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
              title={t`This value has been changed from the game's default.`}
            >
              <Trans>edited</Trans>
            </span>
          )}
        </span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>

      <div className="flex min-w-0 flex-col gap-0.5">
        <SettlingText
          value={row.value}
          multiline={multiline}
          label={label}
          muted={!overridden}
          placeholder={placeholder}
          onCommit={onChange}
        />
        {overridden && (
          <span className="text-[10px] text-muted-foreground">
            {row.present
              ? t`Game value: ${inherited}`
              : t`The game says nothing here.`}
          </span>
        )}
        {!overridden && !row.present && (
          <span className="text-[10px] text-muted-foreground">
            <Trans>The game says nothing here. Anything you type is new.</Trans>
          </span>
        )}
        {!overridden && row.present && row.inheritedFrom && (
          <span className="text-[10px] text-muted-foreground">
            <Trans>
              Untranslated, so the game falls back to{" "}
              {languageLabel(row.inheritedFrom)}.
            </Trans>
          </span>
        )}
      </div>

      {overridden ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onReset}
          title={t`Reset ${label} to the inherited value`}
          aria-label={t`Reset ${label} to the inherited value`}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      ) : (
        <span className="size-7" />
      )}
    </div>
  );
}

export function UnitTextPanel({
  rows,
  home,
  isClone,
  languages,
  language,
  onLanguage,
  onChange,
  onReset,
}: {
  rows: Record<TextField, UnitTextRow>;
  /** Where this unit's words are kept, which is a fact about the game. */
  home: TextHome;
  /** Whether this is a unit the project added, whose definition is its own. */
  isClone: boolean;
  /** Every language the game ships a `units.json` for, English first. */
  languages: string[];
  /** The one on screen. */
  language: string;
  onLanguage: (language: string) => void;
  onChange: (field: TextField, value: string) => void;
  onReset: (field: TextField) => void;
}) {
  const { t } = useLingui();
  // Tabs only where there is somewhere to go. Beyond All Reason ships six
  // translations and every other game measured here ships none, so this is the
  // difference between six tabs and no control at all.
  const translated = home === "language" && languages.length > 1;

  // The game decides, for a unit you added as much as for one it shipped. A
  // copy in a game like Beyond All Reason is named in the localisation file
  // alongside everything else, because that is the only place the game looks
  // (issue #2673).
  const unitsFile = languageUnitsFile(language);
  const namePath = rows.name.path;
  const descriptionPath = rows.description.path;
  const destination =
    home === "language"
      ? t`Kept in this game's ${unitsFile}, not in the unit definition. This game names its units there, so that is where a rename has to go.`
      : isClone
        ? t`Kept in the unit's own definition, since this is a unit you added.`
        : t`Kept in the unit definition, as ${namePath} and ${descriptionPath}.`;

  const fields = (
    <div className="flex flex-col gap-0.5">
      <TextRow
        row={rows.name}
        label={t`Name`}
        hint={t`What a player sees`}
        multiline={false}
        placeholder={t`Unnamed`}
        onChange={(value) => onChange("name", value)}
        onReset={() => onReset("name")}
      />
      <TextRow
        row={rows.description}
        label={t`Description`}
        hint={t`The tooltip under it`}
        multiline
        placeholder={t`No description`}
        onChange={(value) => onChange("description", value)}
        onReset={() => onReset("description")}
      />
    </div>
  );

  // Where the words go, short enough to sit on one line, and how many of the
  // two boxes carry an edit. Between them a shut panel says the two things
  // somebody would open it to find out.
  const changed = [rows.name, rows.description].filter(
    (row) => row.state === "overridden",
  ).length;

  return (
    <SectionPanel
      title={t`Name and description`}
      icon={Type}
      headingLevel={3}
      defaultOpen
      contentClassName="flex flex-col gap-2 p-3"
      summary={
        <>
          {/* Monospaced for the file, because that is what it is, and plain for
              the sentence beside it, which is not. */}
          {home === "language" ? (
            <span className="truncate font-mono">
              {languageUnitsFile(language)}
            </span>
          ) : (
            <span className="truncate">
              <Trans>In the unit definition</Trans>
            </span>
          )}
          {changed > 0 && (
            <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-primary">
              {t`${changed} changed`}
            </span>
          )}
        </>
      }
    >
      <p className="text-xs text-muted-foreground">{destination}</p>
      {translated ? (
        <Tabs value={language} onValueChange={onLanguage}>
          <TabsList aria-label={t`Language`}>
            {languages.map((code) => (
              <TabsTrigger key={code} value={code} title={languageLabel(code)}>
                {code}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={language} className="mt-2">
            {fields}
          </TabsContent>
        </Tabs>
      ) : (
        fields
      )}
    </SectionPanel>
  );
}
