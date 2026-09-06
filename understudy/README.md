# Understudy

A Minecraft mod that plays your character when you would rather it did.

```
/travel -1240 64 380      walk there, however far it is
/build house 9            work out what it needs, then build it
/sort                     put everything in the right chest
/understudy profile       what it has learned about how you play
```

Client-side, Fabric, Minecraft 1.21.4. Nothing to install on the server.

## Client-side, properly

Every command is registered on Fabric's **client** command dispatcher. That is
not a setting — it is where the code runs. A client command is handled inside
your game and intercepted before a chat packet is ever built, so `/travel`
never reaches the server, never appears in chat, and never shows up in a log.
The server sees a player walking.

> Worth saying plainly: plenty of multiplayer servers ban automation of this
> kind, and this is built for your own worlds and servers. It does nothing to
> hide itself from anti-cheat and it is not meant to.

## What it does

**`/travel <x> <y> <z>`** — walks there. A* over the blocks a player can
actually stand in: it uses diagonals, steps up ledges, takes drops it can
survive and refuses ones it cannot, swims when there is no way round, routes
around lava, and will not path into chunks that have not loaded.

Long journeys are not one search. The client only has nearby terrain, so it
searches within a budget, walks what it found, and searches again from there —
which is also what lets it cope with terrain loading as you approach.

The walking is done by holding the same keys you would. Nothing writes to your
position, so the game's own physics and collision apply exactly as when you
play, and letting go stops it mid-tick.

**`/build house|hut|tower|storage [size]`** — designs it, prices it, builds it.
`/plan` does everything except the building, so you can see what a thing would
cost before committing to it.

A house is a house: floor, walls with corner posts, windows on all four sides,
a doorway, a pitched gable roof with an overhang, and a crafting table, furnace,
chest and torches inside. The gable ends are filled in, which is the part that
gets forgotten — leave it out and there are two openings under the roof big
enough for anything to walk through.

It builds bottom-up and, within each layer, works away from the door, so the
last block on every course is the one nearest the way out and it cannot wall
itself into a corner. Blocks already in place are skipped, so an interrupted
build resumes instead of starting over. Windows, furniture and torches are
optional: running out of glass costs you the windows, not the house.

`/build storage 16` sizes the room to the number of chests you asked for.

**`/sort`** — reads every chest nearby, works out which one each kind of thing
belongs in, and puts your haul away. The assignment is sticky: a chest that
already holds mostly ore stays the ore chest, so running it twice does not
rearrange your base. Anything with nowhere to go is reported rather than dumped
somewhere arbitrary.

Your tools, weapons, armour and food stay on you. `/sort all` includes them, for
when you actually want to empty out.

## It adapts to how you play

Everything below is watched, not configured.

| It notices | It uses it for |
|---|---|
| the blocks you build with | the palette of anything it builds for you |
| whether you tunnel through hills or walk round | how willing `/travel` is to dig |
| whether you swim or go round the lake | the same |
| whether you sprint everywhere | how it moves |
| the y-level you actually mine ore at | where it looks for ore |
| whether you fight mobs or avoid them | how it handles trouble |

The important part is that it **forgets**. Every observation decays with a
half-life of about two hundred, so what you did yesterday outweighs what you did
in January and the profile follows you as you change. A plain counter would
describe your first week of playing and never update — which is the difference
between adapting and merely accumulating. The first value I tried would have
taken thousands of blocks to notice you had switched building material; there is
a test that fails if it ever gets that sluggish again.

`/understudy profile` shows you what it thinks, including how confident it is.
A thing that adapts to you silently is impossible to trust or correct.

## Installing

Grab `understudy-0.1.0.jar` from the **Understudy** workflow's artifacts on the
Actions tab, or build it yourself:

```bash
cd understudy && ./gradlew build      # jar lands in build/libs/
```

Then, in Prism Launcher:

1. Edit your 1.21.4 instance → **Version** → make sure **Fabric Loader** is
   installed.
2. **Mods** → **Add** → pick the jar. You also need
   [Fabric API](https://modrinth.com/mod/fabric-api) for 1.21.4.
3. Launch. `/understudy help` lists the commands.

## Building and testing

```bash
cd understudy
./gradlew build      # compiles the mod and runs the tests
./gradlew test       # tests only
```

Most of the mod is deliberately written so it can be tested without a game to
put it in. The pathfinder works against a four-method view of the world, so it
is exercised against a hand-built voxel world rather than needing a running
client to debug in: corner cutting, unbreakable barriers, safe versus lethal
drops, unloaded chunks, budget exhaustion, and the partial-path case all have
tests that run in about a second. The designs, the sorting rules and the
adaptive profile are the same. `dev.understudy.mc` is the only package that
imports Minecraft, and it is the dull part on purpose.

## What is and is not verified

Honest accounting, because the two are different:

- **Compiled and unit-tested.** 58 tests covering the pathfinder, the designs,
  the sorting rules and the profile, plus a full build against Minecraft 1.21.4
  and Fabric on every push. The build is the only compiler this has — the
  machine it was written on cannot reach Fabric's or Mojang's servers at all —
  so nothing goes in unchecked.
- **Not yet run in a real client.** I could not launch Minecraft to try it.
  The search, the designs and the sorting are tested; the parts that touch the
  game — walking, placing blocks, opening chests — compile against the real API
  and follow the ordinary patterns, but nobody has watched them work yet. Treat
  the first run as a test, on a world you do not mind.

## Known limits

- **`/travel` will not dig or bridge yet.** The search supports both and is
  tested on both, but the walker cannot break or place while moving, and a route
  that assumed it could would walk into a wall and stand there. So it is off
  until the walker can do it.
- **Doors, stairs and slabs are placed as plain blocks or skipped.** Their
  orientation comes from where the player is standing and looking, which the
  builder cannot yet guarantee, and a roof of wrongly-facing stairs looks worse
  than one made of honest blocks.
- **It does not gather materials for you yet.** `/build` tells you exactly what
  you are short of; getting it is still your job.
- **Chest reading needs the chest loaded.** Contents come from the client's own
  copy of the world, so a chest the server has not sent yet reads as empty and
  is treated as unclassified.
