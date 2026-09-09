# Understudy

A Minecraft mod that plays your character when you would rather it did.

```
/travel -1240 64 380      walk there, however far it is
/build                    open the menu: pick what, pick where, it does the rest
/build manor 15           or say it outright
/plan manor 15            what it would cost, before committing to it
/paste                    the same menu, and the building is simply there
/sort                     put everything in the right chest
/stash                    a chest of spares here, for after you die
/understudy profile       what it has learned about how you play
/understudy test          check every moving part, and say which one is broken
```

Client-side, Fabric, **Minecraft 26.2**. Nothing to install on the server.

## Client-side, properly

Every command is registered on Fabric's **client** command dispatcher. That is
not a setting — it is where the code runs. A client command is handled inside
your game and intercepted before a chat packet is ever built, so `/travel`
never reaches the server, never appears in chat, and never shows up in a log.
What other players see is a player walking.

One honest exception: if the mod fails to load, `/travel` is not intercepted and
goes to the server as an unknown command. A broken install is visible in a way a
working one is not.

> Worth saying plainly: plenty of multiplayer servers ban automation of this
> kind, and this is built for your own worlds and servers. It does nothing to
> hide itself from anti-cheat and it is not meant to.

## What it does

**`/build`** opens a menu of everything it can build, each with a picture, a
description, a size, a choice of materials and what it will actually cost —
the real plan run against your real inventory, so it says four minutes when you
have the wood and twenty when you do not.

The pictures are drawn from the blueprint, not fetched from anywhere. A
photograph off the internet shows someone else's house, in someone else's
materials, at a size this is not going to build. This shows the exact structure
that will be placed, in the palette it will use, and it redraws when you change
either.

Pick one, then drag out the plot: tap crouch at one corner, look to the far
corner, press Enter. Crouching rather than clicking, because a click already
means something — left breaks the block you are aiming at, right places one —
and a site picker that mines a hole while you choose where to put the house is
not a site picker.

**The plot decides the size.** Drag a bigger rectangle and you get a bigger
house, regenerated to the largest that fits and turned to lie the same way
round as the ground you dragged. `R` turns it a quarter by hand, and Page Up
and Page Down lift it off the ground. An imported schematic is the one thing
that cannot resize — it is the size somebody saved it at, and resampling a
structure damages it rather than scaling it — so it says so instead of offering
a control that would lie.

Then it goes and does the whole thing: works out what is missing, mines it,
crafts it, and builds. Nothing else typed in between.

**Take the controls at any time.** Move, look around or open a chest and it
lets go at once, keeping the plan; it picks the work back up after ten seconds
of you doing nothing at all. Its own walking and its own head-turning do not
count as you — which sounds obvious and is the thing that took two goes to get
right.

**Materials.** Eight woods and seven masonries, as coordinated sets — choosing
spruce moves the planks, logs, stairs, slabs, fences, door and trapdoor
together, because spruce walls with oak stairs look like a mistake.

**Import.** Drop a `.litematic`, `.schem` or structure `.nbt` into
`.minecraft/schematics` and it appears in the same menu, with a picture and a
cost like anything else. All three formats carry full block states, so an
imported roof keeps its orientation instead of arriving as a pile of stairs.

**`/travel <x> <y> <z>`** — walks there. A* over the blocks a player can
actually stand in: diagonals, steps up ledges, drops it can survive and refuses
ones it cannot, swims when there is no way round, and re-plans as terrain loads.

**`/sort`** — puts everything in the nearest chests by category, and keeps
putting each thing where it put it last.

**`/paste`** — the same menu and the same drag, and then the building is simply
there. In your own world it goes through the integrated server's own console,
which is permission level four whether or not cheats are on, so a survival world
you never enabled cheats in still works.

On somebody else's server it uses your own permission if you have it. If you do
not, what happens depends on the game mode, and the honest version is worth
stating plainly:

- **Creative** — it builds it instead: the same plan in the same place, walked
  up block by block at instant speed. Costs nothing but the walk. Creative is a
  much smaller thing for a server owner to hand out than operator, which is
  every command on the server.
- **Survival** — it cannot happen, and the mod says so instead of starting
  something that cannot finish. The server owns the world and it owns your
  inventory. A command needs the permission; a placement needs the item, and the
  server is the one counting items. A client cannot add to that count, and one
  that pretended to would only draw blocks that vanish on the next update.

It works out which of those it is before sending anything, so nothing is
attempted and no red error appears in the chat.

**`/stash`** — puts a chest down beside you and fills it with a second set:
armour, a sword, the four tools, food, torches and a stack of stone. It is what
you want after dying a thousand blocks from home, and it is a five-minute job by
hand that nobody does. It never takes the kit you are wearing — every line of
the list says how many must stay with you, and only the surplus moves — and it
writes down where it put the chest, so `/stash where` can say. `/stash needs`
lists what to be carrying for a full one. In creative it is stocked in full.

`/stash flight` is the same idea for the other way of getting stranded: rockets,
a spare pair of wings, and the membrane to mend them with. And `/stash <item>
[n]` stashes anything at all — `/stash rockets 64`, `/stash ender_pearls 42`,
`/stash arrows+bread 32` for that many of each. Short names and plurals reach
the right item, and nothing is held back from something you named yourself:
choosing it is the whole of the instruction.

Nothing about `/stash` is a command sent to the server: it holds a chest,
right-clicks the ground and shift-clicks stacks across, which is what a player
does.

**Every command** is in [COMMANDS.md](COMMANDS.md), which is generated from the
same list `/understudy help` and the control panel read, so the three cannot
drift apart.

## Not getting you killed

There is a guard watching while it drives, and it is honest about what it can
promise. It cannot stop a creeper that spawns adjacent and detonates inside its
fuse. What it ends is every death caused by the mod not paying attention:
walking on while starving, digging at two hearts, staying under until the air
runs out, carrying on while something lands hits.

Rules are ordered by how little time there is to react — lava outranks low
health, because lava kills in about a second and low health can be walked away
from. It keeps two seconds of health history, because fourteen hearts steady and
fourteen hearts arrived at from twenty are the same reading and want opposite
responses. It eats before hunger stops you sprinting rather than after.

When something is actively hurting you it stops and gives you back the controls
rather than running somewhere of its own choosing. A retreat picked by something
that cannot see what hit it is as likely to find a ledge as safety.

## Looking like a person

The first version walked at the next block's centre and turned a fixed number of
degrees per tick, and looked exactly as bad as that sounds. Four things fix it:

- **Path smoothing.** A* moves between cell centres, so open ground comes back
  as a staircase. Followed literally that reads as a wobble because it is one.
- **Aiming ahead.** Steering at a point along the route rather than the next
  block starts the turn before the corner and finishes it after.
- **A neck, not a stepper motor.** The view is a mass on a spring, slightly
  underdamped, with bounded torque as well as bounded speed — so a turn
  accelerates, decelerates and settles.
- **Reaction time and tremor.** The target is committed to for 150-400ms rather
  than re-read every tick, and a settled view still drifts. A view that tracks
  with zero lag and zero drift is the clearest sign nobody is holding the mouse.

## How it decides what to gather

Ask for a manor from an empty inventory and it works out that it needs a stone
pickaxe, which needs cobblestone, which needs a wooden pickaxe, which needs
planks, which need a log — four levels nobody wrote down anywhere.

That is Knuth's generalisation of Dijkstra to hypergraphs, because a recipe needs
*all* of its inputs, so an item's cost is a sum over a set and a plain graph
search cannot express it. Search time is charged per trip rather than per block,
since once you are standing in a deepslate layer the next block is right there.
Which tool to mine with is decided where the quantity is known: wood for eight
blocks, five stone pickaxes for six hundred. Nobody told it that; it falls out of
the costs.

## Building against Minecraft 26.2

Minecraft 26.x ships **unobfuscated**. Mojang publishes no `client_mappings`
after 1.21.11 and Yarn has no 26.x entries, so the build declares no mappings at
all and uses loom's `net.fabricmc.fabric-loom` plugin — the no-remap one. The
legacy `fabric-loom` id takes the obfuscated path and demands mappings whatever
the dependency block says.

The game is also undocumented, so `api-questions.txt` lists classes whose shape
the code needs and CI prints their real members on every build. Guessing at them
one round trip at a time is what made the first port take a day.

## Layout

```
core/     no Minecraft imports at all — pathfinding, planning, designs,
          the schematic reader, the survival rules. Unit tested.
human/    reaction times, tremor, the turn dynamics.
mc/       the dull adapters that make the real game look like core's world.
client/   commands and the tick loop.
```

The split is not tidiness. When the game renamed every class it touches,
everything in `core/` and `human/` was untouched, and it is why 140 tests can run
in a container with no Minecraft in it.

## What is and is not verified

Verified: 140 unit tests covering the pathfinder, the smoother, the turn
dynamics, the survival rules, the material planner, the designs, the previews
and the schematic reader — including a litematic entry that straddles two longs,
which is the one thing in that format that fails silently rather than loudly.
The whole thing compiles against real Minecraft 26.2 in CI.

Not verified: anything that touches a running game. There is no Minecraft in
the container this was written in, and the sandbox cannot reach Mojang's
servers. Every claim about in-game behaviour is untested until you launch it.
`/understudy test` reports each moving part separately for exactly that reason.
