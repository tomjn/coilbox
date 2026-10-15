# Load test a lobby server with uberstress

Only run a test against a lobby server you run, or one whose owner has agreed to it. A test opens many connections at once, registers accounts and sends chat and battle commands, and to anyone else it looks like an attack.

uberstress is a load tester for uberserver that comes with coilbox. It connects many fake clients to a lobby server, has them log in, chat or host battles, and measures how long the server takes to answer. Each run is saved, so you can compare the server before and after a change.

The tools are under uberstress in the sidebar:

- Run starts a test and shows its progress.
- History lists past runs and draws graphs of them.

## Which servers it works with

uberstress is written for uberserver. Bench mode and Seed SQL only work with uberserver, because they start an uberserver checkout and write to its database.

Coilbox does not check which server software is at the address you give it. Teiserver, which Beyond All Reason runs, is stricter than uberserver in several ways. If you test a Teiserver or Zero-K server, some failures may come from those differences rather than from load.

## Turn on uberstress

uberstress is hidden until you turn on Advanced mode.

1. Open Settings, then General.
2. Under Advanced tools, turn on Advanced mode.

uberstress now appears in the sidebar, with Run and History under it.

## Settings

Open Settings, then Advanced > uberstress. Changes save as you type, and there is no Save button.

### Lobby servers

This is the list of servers that Run offers as targets.

1. Select Add server.
2. Type a Name, such as "Test server".
3. Type the Address as host and port, such as `127.0.0.1:8200`.

The bin beside a server removes it from the list.

### Run defaults

These fill in the Run page each time you open it.

- Scenario is the test to run. It starts as login-storm.
- Connections is how many clients connect at once. It fills in Concurrent connections and starts at 100.
- Duration is how long the clients stay connected once they are all in. It fills in Hold time and starts at `30s`.
- Ramp is how long it takes to connect them all. It starts at `10s`.

Durations are written as a number and a unit, such as `200ms`, `30s` or `1m30s`.

### Bench & database

These settings are only used by bench mode. See [Bench mode](#bench-mode).

## Scenarios

Each scenario tests a different part of the server. The Scenario menu lists them.

- login-storm logs the test accounts in over the ramp and keeps them connected. It tests `LOGIN`.
- register-storm sends a `REGISTER` from every connection and keeps them connected. It does not register accounts first.
- chat has the clients join channels and `SAY` something at a steady pace.
- battle has some clients host battles over TLS with `OPENBATTLE`, while the rest `JOIN`, change their battle status and `LEAVE`.
- battle-list opens many battles, then runs a login-storm, so every login receives the full battle list.
- social has each client add and remove ignores with `IGNORE` and `UNIGNORE`, and ask for its ignore and friend lists.

uberstress also opens extra connections, called pingers, that send `PING` throughout a run. Their response time shows how quickly the server answers while it is busy.

## Run a test

1. Open uberstress > Run.
2. Leave Load selected.
3. Under Target server, pick a server from your list. To test a server that is not on the list, pick Manual address… and type it under Address.
4. Pick a Scenario.
5. Check Concurrent connections, Hold time and Ramp. They start from your [run defaults](#run-defaults).
6. Select Run test.

Ref label is optional. Whatever you type there is saved with the run and shown in History, so use it to name the server version you are testing, such as "before patch".

### Accounts the test creates

With Seed accounts before the timed phase (register) ticked, uberstress registers its test accounts on the server before the timed part of the run starts. Their names start with the User prefix, which is `uberstress_` unless you change it under Advanced options. They stay in the server's database after the test.

To save that time on every run, create the accounts once with Seed SQL:

1. On the Run page, select Seed SQL.
2. Set Account count to at least the most connections you plan to test with. It starts at 2000, or at the number of connections if that is higher.
3. Check that User prefix and Password match the ones the Run page uses.
4. Select Generate.
5. Select Copy, then run the SQL against the server's database.
6. On the Run page, untick Seed accounts before the timed phase (register).

The SQL only adds accounts that do not already exist, so it is safe to run more than once.

### Advanced options

Select Advanced options to change how the clients behave. The defaults are uberstress's own.

- User prefix is the start of every test account name. It starts as `uberstress_`.
- Password is the password every test account uses. It starts as `stresspw`.
- Channel is the name of the channel the chat scenarios join. It starts as `stress`.
- Channels is how many channels to spread the clients across. It starts at 1.
- Say interval is how long each client waits between chat messages. It starts at `1s`.
- Battle hosts is how many clients host battles in the battle scenario. It starts at 10.
- Pingers is how many extra connections send `PING` to measure response time. It starts at 2.
- Ping interval is how long each pinger waits between pings. It starts at `200ms`.

### Watch the run

While the test runs, the right of the page shows:

- the phase, which is ramping up, then steady load, then finishing
- the time so far against the expected length, which is the ramp plus the hold time
- Sent, the number of commands that have had an answer
- Rate, the commands per second at the moment
- Errors, the number of failures so far

Output below shows everything uberstress prints. Warnings and errors are in amber.

Cancel stops the test and closes its connections. A cancelled run is not saved.

When the test ends, Run complete shows how long it took and the p99 response time for `LOGIN` and `PING`. Select View results to open the run in History.

If the run stopped well before the end of the ramp and hold time because connections failed, a Run ended early warning says how many attempts failed. It usually means the server refused the logins, so the hold never happened.

## Read past runs in History

Open uberstress > History. Runs are listed newest first. Each one shows:

- the scenario
- how many errors it had, if any
- the server address
- the ref label, or "adhoc" if it has none, and the greeting the server sent
- when it ran

All types and All servers at the top of the list narrow it to one scenario or one server.

Select a run to see its results on the right.

### The numbers

The row at the top sums up the run:

- Requests is the number of commands that got an answer.
- Throughput is the number of answers per second.
- Errors is the number of failed connections, logins, timeouts and other failures.
- Success is the share of attempts that worked.
- Elapsed is how long the run took.

Configuration lists the settings the run used.

### Response times

Response times are shown as p50, p95 and p99. p50 is the typical time. p99 is the time that 99 in every 100 answers beat, so it shows the slowest answers players would notice.

- Latency (p50 / p95 / p99) is a bar chart with a group of three bars for each command.
- The table below the charts gives the same figures in milliseconds. It also shows how many of each command were answered, how many failed, the slowest answer and the answers per second.

### Compare two runs

Compare p99 with appears when there is another run of the same scenario. Pick a run and a bar chart shows the p99 of both runs for each command, side by side.

The p99 trend chart appears when there are two or more runs of the same scenario. It draws the `LOGIN` and `PING` p99 of each run over time. It includes every run of that scenario, whatever server it tested, so filter by server in your head when you read it.

### Counters

Counters lists every event the run counted, such as `login_ok`. Counters for failures are red. `dial_error` means a client could not connect at all, which often means the server ran out of connections. `login_error` and `timeout` mean the server refused a login or did not answer in time.

### Run again, export and import

- Re-run opens Run with the run's scenario, server and settings filled in. It does not start the test until you select Run test.
- Export saves the run as a JSON file.
- Import at the top of the page adds a run from a JSON file, such as one a colleague exported.
- Open folder opens the folder where coilbox keeps the runs.

## Bench mode

Bench mode starts uberserver from a checkout on your own computer and tests it. It is for comparing two versions of uberserver's code, not for testing a live server.

It needs:

- an uberserver checkout
- a Python virtual environment in that checkout
- a MySQL server running on your computer

Set it up under Settings > Advanced > uberstress, in Bench & database:

- Server dir is the folder of your uberserver checkout.
- Python is the Python to start it with. If you leave it empty, uberstress uses `venv/bin/python3` inside the checkout.
- Lobby port and NAT port are the ports the test server listens on. They start at 8300 and 8301.
- DB driver, DB name, DB host, DB port, DB user, DB password and mysql binary tell uberstress how to reach MySQL.
- Reset database before each bench run drops and recreates the database named in DB name before every run. It is on by default and register-storm needs it.

Use a database that holds nothing you want to keep. With the reset on, everything in it is deleted before each run.

To run a bench test:

1. Open uberstress > Run.
2. Select Bench.
3. Leave Launch a local server ticked. Untick it to test a server at an address instead.
4. Fill in the rest of the form as for a load test.
5. Select Run test.

In bench mode, Advanced options also has Compare to. Type the path of an earlier run's JSON file to have uberstress compare the new run against it.
