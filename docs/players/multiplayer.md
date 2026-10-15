# Multiplayer battles

A multiplayer battle is a game with other people. You find one on the Battles page, join its battle room, and the game opens for everyone when the host starts it.

There are two kinds of battle:

- A battle on a lobby server. You log in to a server, and its battles are listed for everyone on it.
- A direct room. You host it from your own computer, with no server and no account, and friends join you by address.

Open the Battles page from Multiplayer > Battles in the sidebar.

## Log in to a server

Server battles only appear once you are logged in. Until then, the Battles page says "Not connected to a server". Select Log in to choose a server and sign in. To create an account or add a server, see [Sign in and chat](lobby-and-chat.md).

You can still host and join direct rooms without logging in. See [Host a direct room](#host-a-direct-room).

## Read the battle list

Each server you are logged in to has its own section on the Battles page. Inside a section, battles are grouped:

- Open. Battles you can join now.
- Passworded. Battles that need a password.
- In progress. Battles whose game is already running.

Select a group's name to open or close it. The battle you are in is pinned at the top.

Each battle shows its title, then its map, its game and the player hosting it. On the right is how many players it has out of its limit, for example 1/8, and "+1 spec" when somebody is watching. A lock beside the title means it is locked or needs a password.

To narrow the list, select Filters. You can:

- Search by title, map, host or game.
- Sort by Players, Map or Game. Select the same choice again to reverse the order.
- Hide battles that are Empty, Locked or Full.

## Get told when a battle appears

Select Alert me to have coilbox tell you when a battle you want appears on any server you are logged in to.

1. Type part of the game's name under Game.
2. Add part of a map's name or a smallest number of players, if you want.
3. Leave Has a free slot and No password ticked to skip battles you cannot join.
4. Select Save search.

Coilbox then tells you once when a matching battle appears.

## Join a battle

Select Join on the battle's row, or select the battle itself. You go to its battle room.

If the battle needs a password, a box opens instead. Type the password and select Join.

You can join a battle that is in progress. You go to its room, and from there you choose whether to watch.

To send a friend to a battle, select the link button on its row. It copies an invite link you can paste into chat. When your friend opens the link, coilbox offers to take them to the battle.

## Get the map and game

If you do not have a battle's map, its picture on the Battles page is a download button. Select it to download the map before you join.

When you join a battle, coilbox downloads anything missing by itself: the map, the game, and the engine version the host uses. You see the progress in the battle room.

- A missing map shows "Map not installed" where the map should be, with Download and Rescan.
- A missing game shows a "Game not installed" card, with Download and Rescan.
- The Engine card compares your engine with the host's. If they differ, select Download and the version number to get the host's engine.

Select Rescan if you already have the file but coilbox has not noticed it. Until everything is installed, an amber message at the top of the room says what is missing and the game cannot start for you.

## In the battle room

The battle room has the players on the left, with battle chat under them. The map and the battle's settings are on the right. While you are in a battle, the sidebar shows it under Multiplayer, named after the battle.

### Choose your side and team

Your row in the player list is the only one you can change.

| Column | What it does |
| --- | --- |
| Colour | The square on your row. Select it to pick your colour. |
| Faction | Which side you fight as. |
| Team | Players on the same team share one army and control it together. |
| Ally | Players with the same letter are on the same side and do not fight each other. |

These work the same as in a [singleplayer battle](singleplayer.md#set-factions-teams-and-allies). Some servers choose teams and colours for you, and then those columns are not shown.

To watch instead of play, turn on Spectate at the top of the room. You move to the Spectating list under the players. Turn it off to play again.

### Ready up

Turn on Ready at the top of the room when you are set to play. The first column of the player list shows who is ready, green for ready and red for not ready.

### Start the game

The game can only start when every player is ready.

- If you host the battle, select Start.
- Everyone else sees Vote to start. Select it to ask the room to vote on starting.

When somebody calls a vote, a vote panel appears at the top of the room. Select Yes or No. On some battles you can also select Abstain.

When the game starts, it opens by itself for everyone in the room who has the map, the game and the engine. If something was still downloading, coilbox joins the game as soon as it arrives.

If you leave the game while it is still running, select Rejoin to go back in. If you joined the room after the game started, select Watch to spectate it. The engine has to play through everything that has already happened before you see the live game, which can take a while.

### Battle chat

Battle chat is under the player list. Type in the box and press Enter to send. Shift and Enter starts a new line.

Many battles are run by a bot rather than a person. The bot reads the battle chat and answers there. If the room has a Host commands card, its buttons ask the bot to do things for you, such as Balance or Ring unready.

### The map and the options

The map card shows the minimap, the map's name, its size and its number of start positions. Map, Metal and Height under the minimap change what it shows.

If you are not the host, select Suggest map to propose a different map. The host decides whether to use it.

Start positions shows how players are placed on the map. With start boxes, the boxes are drawn on the minimap.

Battle options shows how many of the game's options the host has changed. Select it to see them all. The options are in tabs for Battle, Game, Map and Units. Only the host can change them, so for everyone else they are read only.

### Add an AI

Under the player list, Add AI lets you add a computer player to the battle, if the room takes them. Pick an AI and select Add. You can change or remove an AI you added from its row.

### Leave the battle

Select Leave at the top of the room. You go back to the Battles page.

## Host a battle on a server

1. On the Battles page, select Host a battle in the section for the server you want.
2. Give the battle a Title. If you leave it blank, coilbox names it after the game.
3. Choose the Engine. Everybody who joins needs exactly this version.
4. Choose the Game and the Map.
5. Set Max players.
6. To make the battle private, type a Password. Leave it blank for an open battle.
7. Select Host battle.

Some servers ask for less. A server that runs the game itself only needs a title, a mode, a map, a player limit and an optional password. On a server with matchmaking, the button is Create a lobby instead.

While the form is open, coilbox asks your router to open the game's port so players can reach you. A line at the bottom says whether that worked. If it did not, players outside your network may not be able to join.

When the battle is up, you are in its room as the host.

### What the host can change

As the host, you can change things nobody else can:

- Change map, under the minimap.
- Start positions: Fixed (map), Choose in-game (start boxes) or Random. With start boxes, draw a box for each ally on the minimap, the same way as in a [singleplayer battle](singleplayer.md#choose-start-positions).
- Every option under Battle options, including Unit restrictions. Reset puts a tab back to the game's defaults.
- Locked, at the top of the room, which stops anybody else joining.
- The menu at the end of a player's row, with Force spectate, Ring and Kick.

To end the battle, select Close, then Close battle. Everybody is removed and the battle leaves the list.

## Host a direct room

A direct room runs from your computer. It needs no server and no account. Players on your home network find it by themselves. Players elsewhere need your address.

### Start a room

1. On the Battles page, select Host on LAN.
2. Give it a Room name and type Your name. Your name cannot have a space in it.
3. Choose the Game and the Map, and set Max players.
4. Leave Room port at 8200 unless something else is using that port.
5. To make the room private, type a Password.
6. Select Start room.

You are then in the room's battle room as its host, and the Battles page shows the room with Share and Stop room.

The form has three more settings:

- Advertise on the local network. On by default. It lets people on your network see the room without being told an address.
- Open ports on my router. Turn it on for players outside your network. It asks your router to open the room's port and the game's port 8452, and tells you whether it worked.
- Approve joins. Nobody gets in until you say so. When somebody asks to join, the battle room shows their name with Approve and Reject.

For a quick game against the computer, select Host vs computer instead. It starts a room straight away with your first game and map and one of the game's AIs, with no form to fill in.

### Invite friends

Select Share at the top of the battle room, or beside the room on the Battles page. It lists this computer's addresses, each with Copy link and Copy address.

- For friends on your network, send the address under On this network.
- For friends elsewhere, send the address under From outside. This needs Open ports on my router to have worked, or the ports opened on your router by hand.

A friend who opens the link sees "Join a room" and selects Open the join form. The form opens with your address filled in.

### Join a friend's room

A room on your network appears under Local Network on the Battles page. Select Join on it, check Your name, add the password if it has one, and select Join room.

For a room somewhere else:

1. Select Join by address.
2. Type the Host address your friend sent you. If they sent an address and port together, paste it all in Host address and the port fills in.
3. Type Your name.
4. If the room has a password, type it under Password (if the host set one).
5. Select Join room.

If the host has Approve joins on, you wait until they let you in.

### Close a room

In the battle room, select Close, then Close battle. Everyone is removed and the room stops. You can also select Stop room on the Battles page.

## Matchmaking

Some servers put matches together for you. On those servers, Matchmaking appears under Multiplayer in the sidebar. It is not there on servers that do not offer it.

1. Open Multiplayer > Matchmaking.
2. Pick a queue and select Search. Each queue says how many teams it has, how big they are and whether it is ranked.
3. Wait. Select Stop searching to give up.

When the server finds a match, a "Match found" panel appears in the corner of any page, with a countdown. Select Accept before it runs out, or Turn down. Once every player has accepted, the game opens by itself.

## Keep a battle to play again

If you host a battle, or the battle is run by a bot, the Presets button under the map can save it. Select Presets, then Save this battle, and give it a name. It goes into your singleplayer presets, with the other players turned into AIs, so you can play the same battle again on your own. See [Battle presets](presets.md).
