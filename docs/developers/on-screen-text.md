# Write on-screen text

These are the rules for the words coilbox puts on screen. Cite them by number in a review. They apply to interface text in `src/`. They do not apply to the fiction in a game or mission, so a sample line of dialogue such as "Contact! Raiders inbound from the north pass." is fine.

## 1. Pick the reader first

Coilbox has two readers. An author debugging a mission wants the path the mission was written to. A player pressing Play does not, and showing it to them is noise.

| Reader | Knows about | Example |
| --- | --- | --- |
| Author | Paths, versions, the test mutator, which route a launch took | "{game} bundles mission runtime version {installed}, and this scenario needs version {required}. The scenario is played through the test mutator instead." |
| Player | What they can do next, usually install something or update coilbox | "{game} cannot play a scenario on its own, so coilbox sets up what it needs. Your copy of {game} is not changed." |

A screen only one reader opens, such as the scenario editor, is written for that reader. When one fact reaches both, keep both sentences in one function that takes the reader, as `src/scenario/wording.ts` does, so they cannot drift apart.

## 2. Say what happened, then what to do

A failure names its cause and the next step. It does not apologise or stay vague.

- Write "The engine stopped with an error. It exited with code {exitCode}."
- Write "A game is running. It writes its widget settings back when it saves or exits, so a widget removed now would come back. Close the game and try again."
- Do not write "Oops, something went wrong" or "Success!".

`describeIssue` in `src/scenario/validate.ts` shows the pattern for a list of problems, which is where it is, then what is wrong.

## 3. Use numbers rather than adjectives

Write "Heightmap 769 x 769 (16-bit)" and "Two spots are 512 elmos apart, extractor radius is 90". Do not write "large map" or "too close" when the number is known.

## 4. Use engine words precisely

Use the word the engine and its community use: elmo, mapx, SMF, mex, splat. When a limit comes from the engine, say so and say why: "The engine refuses a naval building out of the sea, so it wants deeper water."

Build and packaging words are not engine words:

- Name the tool rather than calling it a sidecar, so "pr-downloader is unavailable".
- Say a game archive bundles the mission runtime. Nobody in the Spring community says vendoring.

## 5. Use sentence case

Capitalise the first word and proper nouns only, on buttons, headings and labels: "Start game", "Local network", "Lua console". Lua, Recoil, Conquest and game names keep their capitals. Write coilbox in lower case mid-sentence and with a capital at the start of one.

Write the string in sentence case even when CSS changes how it looks. CSS `uppercase` is for small section labels, badges and the Conquest and Warpath HUD. It does not go on an action button.

## 6. Speak to the reader

Use "you" when you instruct. Do not use first person, marketing language or exclamation marks. A button that is the reader's own answer, such as "I won", is the one exception.

## 7. Leave explanation out of the page

Keep inline only what changes what the reader should do right now: a warning that the data may be wrong, an empty or error state, a count. Method notes and caveats go behind a help icon with a popover or drawer, or in a tooltip. Do not put a small line above a heading.

## Changing a string

The English text is the `msgid`, so changing the words takes the string out of every [catalog](translating-coilbox.md) and it shows in English until someone translates it again. That cost is a reason not to reword a string for taste.

1. Change the string in the source, and any test or docs page that quotes it.
2. If only the case changed, rename the `msgid` in each translated catalog, which keeps the translation.
3. Run `bun run i18n:extract` and commit the `.po` files.
