# Golem

An AI that plays Minecraft. You tell it what you want, in a sentence, and it
works out how to get it and goes and does it.

```
you    golem, get me a diamond pickaxe
golem  on it
       ...
golem  got it. had to make an iron one first, there's a vein at -212, 11, 340
```

It joins as an ordinary player over the vanilla protocol, so there is nothing to
install on the server and nothing to patch into the game. It works on a
single-player world opened to LAN, on your own server, or anywhere else you are
allowed to connect a second account.

## What makes it good

Most Minecraft agents hand the whole problem to a language model and hope. That
fails in a specific, boring way: the model does not know that a diamond pickaxe
needs an iron pickaxe first, forgets you already have three iron, and cheerfully
proposes mining an iron block out of the ground.

So the work is split.

**The planner does the search.** Obtaining an item is a shortest-path problem
over a hypergraph — items are nodes, recipes and mining and smelting are edges
with several tails — and it is solved exactly, by Knuth's generalisation of
Dijkstra. One pass prices all 941 obtainable items in about 50 ms, and every
individual plan after that takes under a millisecond. It is measured in seconds
of expected play, so "mine three more iron" and "kill four more cows" are
directly comparable, which is the whole job.

Given nothing but bare hands, it produces this by itself — nobody wrote the
progression down anywhere:

```
mine 4 spruce_log by hand      craft crafting_table      craft wooden_pickaxe
mine 15 stone with it          craft furnace             craft stone_pickaxe
mine 3 iron_ore, 2 coal_ore    smelt 3 iron_ingot        craft iron_pickaxe
mine 2 deepslate_diamond_ore   craft diamond_pickaxe                  ~4.8 min
```

It knows that a golden pickaxe mines diamond ore faster than an iron one and
still drops nothing. It charges an eighth of a coal per smelt, not a whole one.
It will chop three logs by hand rather than craft an axe first, but it will
craft the axe for forty. And when a remembered ore vein makes a route cheaper,
the plan changes.

**The model does the judgement.** It reads "set us up for a night raid" and
decides that means armour, food, torches and a bed. Then it asks for those four
things and the planner handles every dependency underneath. That keeps the loop
a handful of turns long even for a large request.

**Reflexes run underneath both.** A model asked to mine diamonds does not
reliably notice it is on fire. Eating, fleeing, fighting back and surfacing for
air run on their own timer between tool calls.

## It plays like a person

Not a cosmetic layer — it is wired in below the skills, so no individual skill
can bypass it.

- **Aiming** follows Fitts's law for duration and a minimum-jerk profile for
  shape, with a ballistic movement that overshoots about a third of the time and
  one or two corrections that settle it. An Ornstein–Uhlenbeck process adds hand
  tremor that wanders and pulls back, so the crosshair is never perfectly still.
  Against a real server this comes out as a dozen distinct intermediate angles
  per movement instead of one packet jumping to the target.
- **Reaction times** are log-normal — clustered near a floor with a long tail —
  because a symmetric distribution produces impossibly fast responses as often
  as slow ones, and it is the fast ones that read as machine.
- **It stops.** Short pauses, occasional long ones. An hour of mining with no
  break at all is the loudest tell there is, louder than any single movement.
- **It gets tired.** Timings stretch after the persona's stamina runs out.
- **It types** at its own speed, makes keyboard-adjacent slips, and sometimes
  sends the `*correction` line everyone sends.

Every persona is derived from the bot's username, so the same name always plays
the same way, across restarts and reinstalls. A player whose reaction time
resamples every launch is a different person each session, which is the tell
this exists to remove.

> Use it where you are allowed to. This is built for your own worlds and servers
> where you have permission to run a second account. Plenty of public servers ban
> bots outright, and the humanisation here is about behaving naturally, not about
> getting past a rule someone set.

## Running it

```bash
npm install
npm run build

export ANTHROPIC_API_KEY=sk-...
node dist/cli.js --host localhost --port 25565 --username Golem
```

Then talk to it in chat. Anything addressed to it is a task:

```
golem, get me a stack of torches
golem, follow me
golem, what would a beacon take?
golem, build a 7x7 room here
golem, stop
golem, status
```

To play on a single-player world, open it to LAN from the pause menu and use the
port it prints.

Useful flags — `--help` lists them all:

| Flag | |
|---|---|
| `--owner <name>` | only this player may give orders. Repeatable. Without it, anyone on the server can. |
| `--model <id>` | defaults to `claude-sonnet-5`. Use `claude-opus-5` for harder judgement calls; the loop is latency-sensitive, which is why the faster model is the default. |
| `--provider openai --base-url http://localhost:11434/v1` | run against a local model through Ollama, with no API key and no network. |
| `--no-humanise` | act at machine speed. |
| `--online` | join with a Microsoft account instead of offline mode. |

It remembers things between sessions in `~/.golem/<username>.json` — named
places, where it saw ore, what it tried recently. Ore sightings feed straight
back into the planner as real distances, which is why the second diamond run is
cheaper than the first. It is plain JSON; edit or delete it freely.

## Layout

```
src/mc/        the game's own rules — block hardness, tools, recipes, smelting
src/plan/      the hypergraph solver and the step emitter
src/human/     persona, aim, rhythm, typing
src/bot/       mineflayer binding, perception, navigation
src/skills/    the things it can actually do
src/brain/     the agent loop, tools, and the model providers
src/memory/    what it remembers between sessions
e2e/           a real offline server, and a drive against it
```

## Testing

```bash
npm test        # 92 unit and boundary tests
npm run e2e     # boots a real 1.21.4 server and drives the built bot at it
npm run verify  # typecheck, test, build
```

The unit tests check things against the game rather than against my memory of
it. Dig times are asserted against known in-game values — a diamond pickaxe on
stone is 6 ticks, on obsidian 188 — and the hand-written smelting table (the one
piece of game knowledge `minecraft-data` does not ship) has every item name
checked against the real database, so a renamed item fails the build instead of
quietly breaking the planner.

`npm run e2e` boots an actual offline Minecraft server with a generated world
and drives the built bot at it: joining, perception, humanised aiming measured
on the wire, pathfinding, digging, chat, and a full plan carried out end to end
until the item is really in the inventory.

That last one matters, because most of the interesting bugs only existed at
runtime, and each of the three worst was invisible to a different check.

Typechecking passed cleanly on an ESM import of a CommonJS module that crashed
the moment it was run. Driving the planner turned up a cost that was true only
while a stone pickaxe was mid-expansion, leaked out of its cache, deleted
smelting from the options for iron, and left the bot concluding that the best
way to get an ingot was to go and fight an iron golem — it looked completely
reasonable until you asked it for a shield and it quoted fifteen minutes.

And the third passed every test there was. The aim layer and the pathfinder both
write the view direction every tick, and the pathfinder steers by turning the
head, so during a walk they were sending contradictory angles twenty times a
second — disagreeing on 99% of ticks across a forty-block journey. Nothing
failed; the bot still arrived. It only surfaced because the question asked was
"how much do these two disagree" rather than "did it get there".

Measuring it correctly took a second pass, too. Comparing the two angles is
flaky: the aim layer tracks the pathfinder a tick behind, so a sharp turn reads
as disagreement when nothing is being contested. The exact property is that the
aim layer writes *nothing* while the pathfinder is steering, and counting writes
is what the drive asserts.

## Known limits

- **Chicken eggs, milk and boss drops have no source the planner can model**, so
  anything needing them — cake, a beacon — is reported as impossible with the
  specific missing item named, rather than half-attempted.
- **Search-time estimates are priors, not measurements.** How long it takes to
  find diamond ore cannot be derived from any table. The numbers only ever rank
  routes against each other, and memory of real sightings overrides them.
- **`build_room` is a box.** Anything larger wants a schematic format and a
  materials plan; a half-finished mansion is worse than no mansion.
- **The e2e drive covers the skills it covers.** Combat, chest handling,
  smelting and the model loop itself are typechecked and unit-tested but not
  driven against a live server — flying-squid's world has no mobs or ore to
  drive them with.
