# Base blueprints

A blueprint is a layout of buildings that you draw once and put down wherever you like, such as an opening, a wall or a corner of factories. It has no map and no team. Each blueprint belongs to one game, because it names that game's buildings. Inside a match, the coilbox widget lists your blueprints and gives the orders to your builders.

Open your blueprints from Library > Blueprints in the sidebar.

## The Blueprints page

The page is called Base blueprints. Each blueprint shows a small drawing of its layout, its name, how many buildings it has and the game it is for.

- A blueprint that says build order is built in a set order. See [Set a build order](#set-a-build-order).
- The line with an icon says where the blueprint came from, for example From a shared code, From the hub or Saved in game.
- "That game is not installed here" means you do not have the blueprint's game. You can still keep and share it.
- Select a blueprint to open its page.
- The menu at the top right of each blueprint has Rename and Duplicate.

When your blueprints are for more than one game, a list above them picks one game or Every game.

The buttons at the top of the page are:

- Open a pack, which reads a file holding many blueprints. See [Open a pack](#open-a-pack).
- Save a pack, which writes some of your blueprints into one file. See [Save a pack](#save-a-pack).
- Widget, which installs the widget that lets you use blueprints in a game. See [Install the widget](#install-the-widget).
- Import, which reads a blueprint someone shared. See [Import a blueprint](#import-a-blueprint).
- New blueprint, which starts an empty one.

## Make a blueprint

1. Select New blueprint.
2. Type a name. If you leave it empty, the blueprint is called Untitled blueprint.
3. Pick the game whose buildings you want to use.
4. Select Make it.

The new blueprint's page opens, ready for buildings. You can also save a base you built during a match. See [Save a base from a game](#save-a-base-from-a-game).

## A blueprint's page

The name, the game and the number of buildings are at the top. Blueprints at the top left goes back to the list.

Under them is a flat build grid with the buildings drawn on it. There is no map, because a blueprint is not tied to one. Drag or middle drag to pan, right drag to turn the view and scroll to zoom.

When the blueprint's game is installed, every drawing of it colours buildings the same way the in-game widget does.

Every change saves itself a moment after you make it. There is no save button.

### Add, move and remove buildings

1. Select Pick a unit and choose a building.
2. Click the grid to put one down. Keep clicking to put down more.
3. Press Escape to stop placing.

Drag a building to move it. Select a building to show two buttons beside it. Turn gives it a quarter turn, and Delete removes it. Click bare ground to deselect. Undo and Redo are at the top right of the grid.

The button with the blueprint's name opens a box where you can rename it.

### Set a build order

At first the buildings are in the order you clicked them. To say what gets built first:

1. Select Build order.
2. Turn on Build these in this order.
3. Use the arrows beside each building to build it sooner or later.

Watch it go up plays the layout being built one building at a time. Copy as a build order copies the list.

### Try it on a map

Select Try it on a map, then Choose a map. The blueprint is drawn on the real ground, so you can see which buildings the terrain would refuse. Nothing you do here changes the blueprint. Done with the map puts the view away.

### The other buttons

- Convert swaps the buildings for another side's, in a game with more than one side. Pick the side in Say this blueprint in, check the suggested swaps, then select the Convert button at the bottom.
- Duplicate makes a copy and opens it, so you can change the copy.
- Share gives you a code, a link and a file to send. See [Share a blueprint](#share-a-blueprint).
- Delete removes the blueprint after you confirm.

## Use a blueprint in a game

A widget runs inside the game and lists your blueprints there. You install it once.

### Install the widget

1. On the Blueprints page, select Widget.
2. Select Install widget.

The panel says where the widget goes and whether it is up to date. When coilbox has a newer widget, the button says Update widget. Remove widget takes it out again.

The widget panel opens by itself the first time you start a match. If it never appears, press F11 in the game and check that Coilbox blueprints is turned on.

### Place a blueprint

1. Start a match in the blueprint's game.
2. Open the panel. Select the Blueprints button on the right of the screen, or type /coilbox_blueprints in the game's chat.
3. Select one or more builders.
4. Select a blueprint in the list. Its buildings follow the cursor, which holds the building nearest the middle. A building the ground will not take is marked with dark stripes and a dashed red outline.
5. Press [ or ] to turn it, F to flip it side to side or G to flip it top to bottom. It turns and flips around the building under the cursor. A blueprint with an extractor or a geothermal plant is held by that building instead, and jumps onto a metal or geothermal spot when the cursor is near one, with the rest of the blueprint around it. This works in any game. Shift+[ and Shift+] switch to the previous or next blueprint.
6. Left click to place it.

While you place a blueprint, a second panel opens beside the first. It shows what the blueprint costs and how long your selected builders take to build it. Its buttons do the same as the keys, and each is labelled with the key that does it.

The Builders buttons in that panel choose how the work is shared:

- Together gives every builder every building, so they help each other with each one in turn. In most games this finishes soonest.
- Split up gives each building to one builder, the nearest one, until each has its share. Use this in games such as Splinter Faction, where only one builder can work on a building at a time.

The game remembers your choice for each game.

Each builder you selected is ordered to build the buildings it can. Right click or Escape puts the blueprint away without placing it. Hold Shift when you click to add the orders after what the builders are already doing, and to keep the blueprint on the cursor for another copy. Drag to lay copies in a line, each touching the last, and let go to place them.

A building that would sit partly off the map is marked like one the ground will not take, and is not ordered.

You can only pick up a blueprint your side can build. A blueprint with another side's buildings, such as one recorded by a player on the other faction, shows how many in its row and stays under the All tab.

A building your side only gets by upgrading another, such as a Tech 2 factory that starts as a Tech 1 factory, is placed as the building it starts from. The row says how many buildings you then need to upgrade.

### Plan a base ahead

You can place a blueprint with no builders selected. It stays on the map as a plan, drawn the way it looked while you placed it, and only you can see it. Place as many as you like. When you have the builders, select them and point at a plan. The building under the cursor gets a white outline, and the cursor shows whether they can build it. A building they cannot build is crossed out. Right click to build that building. Hold Shift to outline the whole plan, and right click to build all of it after whatever the builders are already doing. Right click a plan with nothing selected to remove it.

If the panel is in the way, drag the Blueprints button, or the panel's title, somewhere else. Close to the edge of the screen, it snaps to the edge. If another panel of the game is in the way, it slides up or down the edge to a clear spot. The button at the top right of the panel, or selecting the title, closes it. The game remembers where you put it.

Each blueprint shows a small drawing of its layout. Buildings that make energy are yellow, buildings that build are green, and buildings with weapons are red. The marks on the ground use the same colours while you place it.

The two buttons at the bottom right switch between a list and a grid of drawings. In the grid, point at a drawing to see its name and buildings under the grid.

When a tab holds more blueprints than fit, the arrows next to those buttons turn the page. The mouse wheel turns it too.

The panel only lists blueprints for the game you are playing. It has three tabs:

- Now shows blueprints your selected builders can build all of.
- Partly shows blueprints they can build some of.
- All shows every blueprint for this game.

Under each name is where it came from, how many buildings it has and any buildings this game does not have.

If your builders cannot build every building, the rest stay on the map as a plan too. The panel says how many buildings your plans hold. Select builders, then select Place to build them all, or Dismiss to remove every plan.

You can bind other keys. Type /bind followed by a key and an action in the game's chat, for example /bind q coilbox_blueprints_rotate_left, or add the same line without the slash to uikeys.txt. The actions are:

- coilbox_blueprints opens and closes the panel
- coilbox_blueprints_rotate_left and coilbox_blueprints_rotate_right turn the blueprint
- coilbox_blueprints_flip_x and coilbox_blueprints_flip_z flip it side to side and top to bottom
- coilbox_blueprints_prev and coilbox_blueprints_next switch blueprint
- coilbox_blueprints_save saves the selection
- coilbox_blueprints_save_ground starts Save ground

The widget only takes these keys while you place a blueprint, so the rest of the time F still means fight and G still means guard. Some games use [ and ] for their own keys, so those keys may not reach the widget. Bind other keys to the actions in that case.

### Save a base from a game

1. Select the buildings you want to keep.
2. Select Save selection at the bottom of the panel.

The blueprint is named after what is in it, for example "2 Solar Collector, Light Laser Tower". It shows up on the Blueprints page the next time you open it with no game running. It is marked Saved in game.

In a game with terraform, such as Zero-K, Save selection also saves the ground you changed under and round the buildings. A wall you raised with turrets on it is saved as the wall and the turrets. Ground changes that touch the buildings are followed to their end, and ground changes with untouched ground between them and the buildings are left out. The blueprint is then marked Saved from the ground.

### Save ground changes on their own

1. Select Save ground at the bottom of the panel.
2. Drag a rectangle over the ground on the map.

Only the ground changes inside the rectangle are saved, with no buildings. Right click or press Esc to stop without saving. The blueprint is named for what it holds, for example "Raised ground, dug ground", and is marked Saved from the ground.

The game keeps no record of the shapes you drew, only the ground they left. So the widget works the shapes out from the ground: each area raised or dug by about the same height becomes one raise step, and the slopes round it are left out because the game makes them again when the step is placed. Detail is lost on the way. Ground levelled flat across a slope comes back as steps of different heights, for example. Open the blueprint in the editor and check it before you use it.

### Which games it works with

The widget loads in games that load widgets from your content folder. It has been checked with Splinter Faction, Metal Factions and Zero-K. It has not been checked with Beyond All Reason.

Zero-K only loads widgets from your content folder once it has saved its settings, which it does when the game closes. So the widget appears from your second Zero-K match, not the first.

Beyond All Reason has its own blueprint tool. The widget reads that tool's blueprints, and lists them marked BAR. To use your coilbox blueprints with the Beyond All Reason tool, write them into its file. See [Save a pack](#save-a-pack).

## Import a blueprint

1. Select Import on the Blueprints page.
2. Paste a blueprint code into the box and select Read it, or select Read a file… to open a blueprint file.
3. Check what coilbox says about it. It tells you which game the blueprint is for and whether your copy of that game has its buildings.
4. Select Add to my library. If the game does not match, the button says Keep it anyway.

If every building in it belongs to one side and the game has other sides, coilbox offers Keep it as that side or Take it as another side before you add it.

A coilbox link to a blueprint opens the same box with the code already in it, after you confirm.

### From the hub

1. Select Coilbox hub in the sidebar.
2. Select Base blueprints to show only blueprints.
3. Open one and select Import.

Coilbox opens the Blueprints page with the blueprint read in. Select Add to my library. The blueprint's page then has a See it on the hub link.

You can also browse the hub website at [coilbox-hub.vercel.app](https://coilbox-hub.vercel.app).

### Open a pack

A pack is one file holding many blueprints, such as Beyond All Reason's own blueprints file or a file somebody posted.

1. Select Open a pack.
2. Select Open a file… and choose the file.
3. Under Read them against, pick the game the blueprints were drawn in.
4. Tick the blueprints you want. A button such as Tick the 12 that fit ticks every one your game can place.
5. Select Add to my library.

Coilbox never changes the file you opened.

## Share a blueprint

Select Share on a blueprint's page.

- Copy code copies a code. Anyone who pastes it into Import gets the blueprint.
- Copy link copies a coilbox link that opens the blueprint in coilbox. A very large blueprint is too long for a link, so this button does not appear.
- Export as file saves the blueprint as a file.

### Publish to the hub

The bottom of the Share drawer is about the Coilbox hub. If you are not signed in, select Sign in with Discord, or select Copy code & open hub to finish on the hub website.

Once you are signed in:

1. Type a title. A description and tags are optional.
2. Select Publish.

Anyone browsing the hub can then find and import it. Copy link and View on the hub then point at its page on the hub.

## Save a pack

Save a pack writes some of your blueprints into one file, for a game's own blueprint tool or for somebody else.

1. Select Save a pack on the Blueprints page.
2. Tick the blueprints you want. Tick every one ticks them all.
3. Choose where they go.

A button such as Write 3 blueprints into a game's file puts them into the game's own blueprints file, which Beyond All Reason's blueprint tool reads. Coilbox opens the file where your engine keeps it, and copies the file before it changes it. A blueprint with the same name as one already in the file replaces it. Close the game first, because this button is turned off while a game is running.

Save them as a file to share writes a new file you can post. Others open it with Open a pack.
