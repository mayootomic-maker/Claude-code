# Gamble With Your Friends — web build

A browser port of the Steam casino crawler, in one HTML file.

Open **`gamble-with-your-friends.html`**. There is no server, no install and no
network call — double-clicking the file is the whole setup. It is 2.4 MB, which
includes twelve 3D tables, a physics engine and every model in the game.

Five minutes a day inside the tower, in first person. One bank account, shared
with three friends who walk the same floors and can spend it without asking. A
quota every night, a debt that grows 8% while you sleep, and three ways it ends.

**WASD** to walk, mouse to look, **E** to use whatever you are stood in front
of, **Esc** to let the pointer go. On a phone it is a thumbstick, a drag to
look, and a Use button.

---

## What is real

Everything on screen is real-time 3D — there are no pre-rendered images and no
sprite sheets. The models are built procedurally in Blender by
`blender/models.py` and exported as geometry the page decodes itself.

**The dice are thrown.** A cannon.js rigid-body simulation runs the whole throw
before a frame is drawn, and the recording is played back. The number is drawn
from the seeded RNG first and the die's *mesh* is then rotated inside its body
by one of the cube's own 24 symmetries, so the drawn face lands up. The tumble
is untouched, the geometry is identical under that rotation, and the odds on the
label are the odds you get. Letting the physics pick the number instead would
mean the game's odds were the solver's, and nobody can print those on a sign.

**The plinko ball is not steered at all.** It is released with a fraction of a
millimetre of jitter and the pegs do the rest, so that board's payout table
cannot be derived — it has to be measured. `tools/measure-plinko.mjs` drops tens
of thousands of balls and prints the distribution; the multipliers are set from
it, and `tools/odds.mjs` re-measures and checks every pocket against what the
odds panel prints.

**The roulette wheel is a European wheel.** Thirty-seven pockets in the real
sequence, because that order is what stops any sector of the wheel favouring an
outside bet. The rotor turns one way, the ball orbits the other, decays off the
track, crosses the deflectors and drops.

## The tower

It is a building, not a menu. You start in a lobby with a loan shark at his
terminal, a shop, a shelf your purchases sit on and a pair of doors; getting in
the limo is what starts the five minutes. Each casino floor is a hall you walk
around, with the machines standing in it and a lift at the north end.

**The floors are laid out fresh every time you take the lift to one.** Machines
are placed from candidate slots by the run's own seeded RNG, and a slot is only
taken if the machine's real footprint fits: clear of the walls, the pillars, the
lift and everything already placed, *and* with the spot you have to stand in to
play it clear as well. That last check is not an optimisation. Without it four
of the twelve landed with their only approach buried in a pillar — placed,
drawn, lit, and unusable, with the prompt that never appeared as the only clue.

**The friends are in the room.** Mo, Petra, Kez and Den are bodies built from
four Blender parts joined at their own joints, walking on the same collision
solver you do. A turn is: pick a table, say so, cross the floor, bet. The money
moves when the body arrives, not when the decision is made — deciding and
settling in the same frame is what the first version did, and it put a line in
the ticker about a roulette win while the winner was still stood by the lift.
When one of them is about to put the whole account on something, they stop where
they are and argue about it, and you can walk over and shout at them in person
rather than pressing Q from across the building.

Two thirds of their turns happen on the floor you are standing on. They can play
anywhere the bank has opened and a friend upstairs spends the same money — but
a crew that scatters across four floors is one you only ever meet in the ticker,
and the game is not called Read About Your Friends.

## The odds

Every table prints its own house edge, including the number the house would
rather you did not do in your head. Those numbers are not annotations — they are
the values the game computes with, and `tools/odds.mjs` proves it by walking
each game's entire sample space through the game's own outcome function:

| | |
|---|---|
| Roulette | 2.70% on every bet, single zero |
| Over/Under | 2.08% to 8.33% depending on the bet |
| Coin Toss | 2.00% |
| Three Drums | 5.79% — enumerated over all 2,744 stop combinations |
| Duck Race | ~7.3% |
| Blackjack | 0.50% played well, dealer stands on all 17s |
| High/Low, Mines, Crash, The Climb, The Chamber | 4.00% at every depth |
| The Drop | ~6%, measured off the physical board |

The one thing that took real care: several of these games let you keep going —
mines, the ladder, crash, the chamber. It is tempting to take the cut once per
step, and wrong. Compounding it means the eighth rung of the ladder carries a
28% edge while the first carries 4%. The cut is taken once, against the odds of
having got that far, so every depth is the same 4%.

## Running the pipeline

```bash
pip install bpy                                 # Blender as a Python module
python3 gwyf-web/blender/models.py              # build every model -> assets/models.json
python3 gwyf-web/blender/models.py die coin     # or just those

node gwyf-web/build.mjs                          # inline everything -> one HTML file
node gwyf-web/build.mjs --fragment               # same page without the <html>/<head>/<body>
                                                 #   scaffolding, for hosts that supply their own
node gwyf-web/tools/drive.mjs                   # play every table in Chromium, fail on any error
node gwyf-web/tools/odds.mjs 9000               # audit every published number
node gwyf-web/tools/shoot.mjs out.png 4         # contact sheet of the model library
node gwyf-web/tools/measure-plinko.mjs 40000     # re-measure the plinko board
node gwyf-web/tools/run-loop.mjs                 # play whole runs; check all three endings
node gwyf-web/tools/walk.mjs                     # walk the tower with real keys, floor by floor
node gwyf-web/tools/reach.mjs 12                 # every machine usable from its stand point, on 12 layouts
node gwyf-web/tools/crew-shot.mjs out.png        # the four friends, assembled as the game builds them
node gwyf-web/tools/postcards.mjs                # one shot of every machine from where you stand at it
```

`reach.mjs` is the one that guards the floors. `walk.mjs` asks the harder
question — can a player actually get across the room to a table — with a
deliberately dumb pathfinder, so one miss in twelve says more about the
pathfinder than the building. `reach.mjs` asks the invariant underneath it, on a
fresh layout each time: standing where the level says to stand and looking where
it says to look, does the machine answer? A no there is a table nobody can play.

`run-loop.mjs` is the other half of the testing: `drive.mjs` covers the tables,
this covers the days — quota, strikes, interest, the shark taking things, and
whether each of the three endings can actually be reached. It is what caught
the debt being unpayable, which made one of them unreachable by playing.

`drive.mjs` opens the built file in Chromium, walks all twelve tables, plays a
hand at each — answering prompts and clicking tiles on the table — and fails on
any console error. It found the bugs that mattered: a `[hidden]` attribute
beaten by a `display: grid` rule so the boot screen sat invisibly over the page
eating clicks; a hand settling against the wrong table's context after the
player walked away mid-spin, paying `undefined × multiplier` and turning the
bank into `NaN`; and a slot machine whose drums stopped a fraction of a symbol
short of the payline on every spin because the number of revolutions was
fractional.

## Layout

```
blender/     models.py builds every model; exporter.py packs them for the browser
vendor/      three.js and cannon.js (see NOTICE)
assets/      models.json — quantised geometry + materials, one file
src/
  core/      rng, config, run state, audio, the friends
  gfx/       model decoder, HDR environment, stage, physics, cards
  games/     twelve games, one file each, all through one contract
  world/     collision, level generation, the player, the friends' bodies
  ui/        screens, loading, touch controls, mod menu
tools/       drive, walk, reach, odds, shoot, postcards, crew-shot, measure-plinko
build.mjs    inlines the lot into one HTML file
```

**Why no glTF.** `GLTFLoader` lives in three's examples and ships only as an ES
module, which a single self-contained file cannot import without a bundler or a
blob URL a strict CSP will refuse. What these models need is positions, normals
and indices — about forty lines to decode — so `exporter.py` writes exactly
that, quantised to Int16 across each mesh's bounding box.

**Why the odds live in `src/core/config.js`.** Prices, quotas and unlocks are in
one file so the whole economy can be read at once; payouts sit with their games
because that is where the outcome function is, and the audit walks both.

## The mod menu

**F1.** Fifty-odd switches across seven pages — bottomless account, never lose,
frozen clock, every floor open, nobody tilts — in the same Velvet theme as
[GambleMenu](../gwyf-mod-menu), the BepInEx mod menu for the real game that
lives next door in this repository. Switching anything on marks the run, and the
ending says so. It is not hidden because there is nothing here worth hiding.

## Performance

The renderer watches its own frame time and gives up detail in order: pixel
ratio first, then shadow resolution, then shadows. On a software rasteriser
(which is what the test harness uses) that takes blackjack from 2.8 fps to about
20; on any real GPU it never leaves the top tier.

Three things cost most of the frame before they were fixed, and all three are
worth knowing about:

- **`MeshPhysicalMaterial` everywhere.** It compiles in the clearcoat and
  transmission lobes whether or not they are used, and transmission forces a
  second full-scene pass. Materials are promoted to physical only when they
  genuinely use those features — the duck race's water is not glass any more.
- **Forty-two symbols on three slot drums.** Two thirds of them are round the
  back where the cabinet hides them. Culling by drum angle took the machine from
  299 draw calls and 274k triangles to 94 and 36k.
- **The tables were triangle fans z-fighting with the top cap of their own
  aprons**, which drew a dark sunburst across every felt in the building. It
  looked exactly like shadow acne, which is what made it expensive to find.

## Limits, stated

- **There is no pointer lock on a phone**, so the touch build is a second set of
  inputs rather than a smaller version of the first: a thumbstick that recentres
  wherever your thumb lands, a drag anywhere else to look, and a Use button. It
  appears only on a device with a touchscreen and no mouse — a laptop with a
  touchscreen keeps the keyboard, because a thumbstick pinned over the corner of
  a desktop window is a bug.
- **WebGL 2 is required.** There is no 2D fallback, because there is no version
  of this that is not 3D. If the context is refused the page says so plainly.
- **The web fonts are the one network request.** They come from Google Fonts and
  the page falls back to a system stack offline; nothing else is fetched.
- **Saves live in `localStorage`.** The mod menu exports and imports a run as
  JSON, which is the only defence against a browser clearing site data. How the
  export leaves depends on where the page is open: hosted in a sandboxed viewer
  a page cannot save a file by itself, so it asks the host and the viewer
  confirms; opened from disk a blob download is the real thing; where neither
  works the JSON goes on screen to be copied. Nothing reports a file was saved
  unless one was — an `<a download>` inside a sandbox does nothing at all,
  silently, and a player who trusts that message loses the run they thought
  they had kept.
- **The seed is drawn once and saved with the run**, so reloading continues the
  same stream rather than re-rolling a spin you did not like.
- **This is a game about a debt spiral, not an advertisement for one.** There is
  no real money in it, nothing to buy, and every house edge is printed on the
  table it belongs to.
