# Settings and keybinds

Coilbox can change how the game looks, sounds and handles, and what each key does in it, without you opening a config file. This page covers the engine settings, the keybinds editor and the settings for coilbox itself.

To open Settings, select Settings at the bottom of the sidebar. The list on the left of the Settings page has every section.

Some sections have their own guides:

- Library, which holds Content folders, Engines, Sources, Storage and Import, is in [The Library](library.md).
- Multiplayer, which holds Lobby servers, Chat highlights, Ignored users and Account, is in [Sign in and chat](lobby-and-chat.md).
- Coilbox hub is in [The Coilbox hub](hub.md#settings).

## Engine settings

Engine Settings changes the settings the game reads when it starts. It has five pages of settings:

| Page | What it has |
| --- | --- |
| Display | Fullscreen, borderless window, resolution and VSync. |
| Graphics | Shadows, water, particles, ground detail and anti-aliasing. |
| Sound | Master volume, and the volume of each kind of sound, such as music, battle and UI. |
| Input and camera | Camera mode, edge scrolling, scroll wheel speed and the mouse. |
| In game | Your player name and team highlight. |

Each setting is a tick box, a list, a slider or a box you type in. Coilbox saves a change as soon as you make it. The game uses it the next time it starts. A setting you have changed has a Reset button beside it, which puts back the engine's default.

The name at the top of each page is the engine whose settings you are changing. If you have more than one engine, pick another from the list there. Rescan reads the settings again.

Your player name is replaced by your lobby name when you play online.

If the page says no engines were found, add one first. See [Engines](library.md#engines).

## Keybinds

Open Engine Settings > Keybinds to see and change what every key does in the game.

The page shows a keyboard. Select a key to see what it does.

1. Pick the game under Bindings a game brings with it. Each game comes with its own keys, and the editor starts from those.
2. Pick a layer above the keyboard: Plain, Shift, Ctrl, Alt or Any. Shift shows what each key does while you hold Shift, and so on.
3. Select a key. Its bindings appear under the keyboard.
4. Make your changes.
5. Select Save to uikeys.txt.

Nothing changes in the game until you save. Revert throws away the changes you have not saved.

To change a key:

- To add an action, type it in the box under the key's bindings and select Add.
- To take one off, select Remove beside it.
- To move everything on this key to another key, select Press a key, then press the new key or combination. Cancel stops without moving anything.
- Reset puts the key back to what the game or engine had.

Beside each binding it says where it came from: engine default, from the game, or you changed this. One key can have more than one action. The game runs the first one that applies.

The list under the keyboard has every binding. Type in Search by key or action to find one. Bindings you changed are marked yours. Bindings that share a key with another are marked shared key. Select a key in the list to open it on the keyboard.

### Save and share a keymap

Saved keymaps, at the bottom of the Keybinds page, keeps a set of keybinds under a name.

1. Type a name in Name this keymap.
2. Select Save.

Each saved keymap has these buttons:

- Apply loads it into the editor. Select Save to uikeys.txt to use it in the game.
- The download button exports it to a file.
- The link button copies a link to it that you can send to someone.
- The bin deletes it.

Import at the top of Saved keymaps loads a keymap file somebody sent you. A keymap link opens on this page and loads into the editor. It does not save until you select Save to uikeys.txt.

## Saved configs

Saved configs keeps a copy of all your engine settings at once, so you can switch between setups. One copy holds the engine settings, the keybinds and the settings of the game's in-game widgets.

To keep a copy:

1. Open Engine Settings > Saved configs.
2. Under Settings profiles, type a name in New profile name.
3. Select Back up.

To switch to a saved copy, select Restore beside it. Coilbox asks before it replaces your current settings. Select Overwrite to go ahead.

Tick Auto-backup current settings before restoring to keep a copy of your current settings each time you restore. It is saved as Auto-backup.

The bin beside a copy deletes it.

## Engine log

The engine writes a log every time the game runs. It is the file to look at after a crash, and the file to send when you ask for help.

Open Engine Settings > Engine log.

- Open the log file opens the log.
- Show in folder shows the file on your computer.
- Reload looks for the log again, for example after another game.
- Copy system info copies your system, your coilbox version, your engine version and where the log is.

The page shows when the log was written. Check it is from the game that crashed.

The end of the log shows what the engine was doing when it stopped. Search the file for the word Error. The last errors before the end are usually the ones that matter.

When you ask for help, send the whole log file and paste the system info with it.

When a singleplayer game crashes, coilbox also shows what went wrong straight away. See [After the battle](singleplayer.md#after-the-battle).

## Notifications

Coilbox tells you when something happens, such as a download finishing or failing. The bell at the top right of the window lists the recent notifications. Some take you to the page they are about when you select them. Clear all empties the list.

Open Settings > Notifications to choose how you are told:

- Desktop notifications shows a notification from your computer when coilbox is in the background.
- Notification sound lets that notification make your computer's notification sound.
- If coilbox does not have permission to show notifications, select Grant permission.
- Send test notification shows one so you can check it works.

Battle alerts lists the alerts you set up with Alert me on the Battles page. Use the switch to turn one off, or the bin to delete it. See [Get told when a battle appears](multiplayer.md#get-told-when-a-battle-appears).

## Sound

Settings > Sound sets the sounds coilbox itself makes. It does not change the sound in the game. For that, use [Engine settings](#engine-settings).

- Master volume sets the volume of every coilbox sound.
- Mute all sound silences them all.
- Music picks the music coilbox plays. Play music starts it.
- Groups has a volume and a mute for Alerts, Interface and Music.
- Sounds lists each event that plays a sound, such as Mentioned in chat or The host starts the game. Pick another sound from its list, set its volume or mute it. The preview button lets you hear it.

## Appearance

Settings > Appearance changes how coilbox looks.

- Theme is Light, Dark or System. System follows your computer.
- Base color sets the colour of the background and panels.
- Accent color sets the colour of buttons and highlights.

## General

Settings > General has:

- Interface size, which makes everything in coilbox bigger or smaller. Cmd or Ctrl with plus and minus does the same. Cmd or Ctrl with 0 puts it back to 100%.
- Fullscreen, which runs coilbox in fullscreen. F11 and the button at the top right of the window do the same.
- Show frame rate, which shows how fast each 3D view draws.
- Reduce motion, which stops background animation. Follow system uses your computer's setting.
- Ambient effects, which turns the decorative effects on or off.
- Performance mode, which draws 3D views at a lower quality. Turn it on for a laptop or an older computer.

### Advanced mode

Advanced mode is under Advanced tools on the General page. It is off unless you turn it on.

It adds the tools for making games, maps and missions to the sidebar and the home page:

- Archives, under Library, to look inside game and map files.
- Rapid repositories, under Library, to browse a rapid server and download any version it holds. See [Rapid repositories](#rapid-repositories).
- uberstress, to load test a lobby server.
- Campaign Builder, to make campaigns and scenarios.
- Mapping Tools, to build and take apart maps.
- unit builder and workshop, to make units and change existing ones.
- animation, to convert unit animation scripts.

These are covered in the [game developer guides](../developers/index.md). You do not need any of them to play.

#### Rapid repositories

Some games are not single files. They come as rapid packages, which download only the parts that changed since your last version. Beyond All Reason is one of them. The Games page and a game's Versions tab already list the rapid versions of the games coilbox knows. Rapid repositories lets you browse a whole rapid server.

1. Open Library > Rapid repositories in the sidebar.
2. Pick a server from Select a rapid repository…. Coilbox loads the repositories it holds. Load repos reads them again.
3. Select a repository on the left. Its versions appear on the right.
4. Select Download on the version you want.

Type in Filter repositories… or Filter versions… to find one in a long list.

Coilbox starts with one server, called Spring. To add another, open Settings, then Library > Sources. Select Add repository, then type its Name and its Master URL. The bin beside a server removes it.

## Updates

### Coilbox updates

Coilbox checks for a new version when it starts. When there is one, Update available appears at the top of the window. Select it, or open Settings > Coilbox updates.

- Current version is the version you have.
- Check for updates checks again now.
- Download & install gets the new version.
- Restart now starts the new version once it is installed.

If your copy of coilbox came with a game, the people who made it may handle updates instead. The page then says so and has no buttons.

### Game updates

If your copy of coilbox came with a game, Settings may also have Game updates. Coilbox checks for a new version of that game when it starts, and shows Game update at the top of the window when there is one.

Open Settings > Game updates, then select Download & install. Check for updates checks again now.
