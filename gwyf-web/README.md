# Gamble With Your Friends — web build

A browser port of the Steam casino crawler, in one HTML file.

Open **`gamble-with-your-friends.html`**. There is no server, no install and no
network call — double-clicking the file is the whole setup. It is 2.4 MB, which
includes twelve 3D tables, a physics engine and every model in the game.

Five minutes a day inside the tower, in first person. One bank account, shared
with three friends who walk the same floors and can spend it without asking. A
quota every night, a debt that grows 8% while you sleep, and three ways it ends.

**WASD** to walk, **Shift** to run, **Space** to jump, **Ctrl** to crouch, mouse
to look, **E** or a click to use whatever you are stood in front of, **Esc** to
let the pointer go. Look sensitivity, invert, camera smoothing and head bob are
in the menu behind the gear. On a phone it is a thumbstick, a drag to look, and
a Use button.

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

## The way in

It opens on a title screen, over the lobby — the real one, with the camera on a
slow arc through it, so the first thing you see is the place you are about to
walk around rather than a picture of it. By the time you press Play the models,
the environment map and the first frames are already paid for.

Play, Continue, Play together, How this works, Settings. The spade in the corner
brings it back at any point, and saves on the way out, because the menu is where
people close the tab.

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

**The interface is in the corners**, not in a bar above the game: tickets and
the challenge card top-left, DAY ENDS IN over the clock top-centre, the day, the
shared account in green and the quota in red top-right with everyone's running
total under it. That is how the original arranges it, and it hands the room the
whole frame.

**The friends are in the room.** Mo, Petra, Kez and Den are bowling pins about
two heads tall -- a wide oval head on a tapered footless body with no legs, two
enormous eyes under one thick brow bar, and a pair of mitten hands that float
unattached beside them, which is what the game this follows draws everybody as.
Your own two hands sit in the bottom corners of the screen, tinted your colour.
They walk on the same collision solver you do. A turn is: pick a table, say so, cross the floor, bet. The money
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

## Playing with other people

Real multiplayer, with no server anywhere, because there is nowhere to run one.
Press the handshake in the top bar, or **M**.

**Another window on this computer** needs nothing at all: open the page twice,
host in one and join in the other. `BroadcastChannel` connects same-origin
windows directly, and it works from a `file://` page as well as a hosted one.

**Another computer** is a WebRTC data channel, peer to peer, signalled by hand —
the host makes a block of text, the guest pastes it and hands one back, and
after that the two browsers talk directly with nothing in between. About 900
characters each way, once.

**Anyone on the internet** needs no code at all. Type a name, press *Host a
public lobby*, and the game appears on a list that every other copy of it is
watching; anybody can read the list and press *Join*. The list rides on a free
public MQTT broker — three of them, tried in turn, because a free broker is
somebody else's goodwill — over a hand-rolled client of about 190 lines. A
library would have cost more than the rest of the game.

Be clear about what that is: an open, unauthenticated bus. Anyone who finds the
topic can read what is on it or walk into your lobby. The interface says so
rather than leaving it to be discovered. It is tested against a real
third-party broker (aedes) on localhost, driven through the interface only —
`tools/open-lobby.mjs`. It has never been exercised against the public brokers,
because this container cannot open an outbound WebSocket at all.

Inside the claude.ai artifact viewer the second and third are **not available,
and the page says so** rather than offering a button that cannot work: the
viewer deletes `RTCPeerConnection` before the game loads, and its CSP refuses
the WebSocket the broker needs. Download the HTML file and open it from your own
machine and both work.

**What is shared, and what is not.** The host's bank is the bank — that is the
whole game, so it is the one thing that has to be authoritative. Everyone else
keeps their own copy of the world, walks it themselves and plays their own
tables at full frame rate; what travels is money moving and where people are
standing. Nobody has to send a room, because a floor's layout is derived from
the run seed and the floor number, so two machines build the same hall from the
seed alone.

The trust model is deliberate, and it is the game's own: anyone at the table can
empty the account. A guest who lied about a payout would be doing by hand
exactly what the game invites its friends to do anyway. This connects people who
passed a code to each other, not strangers.

## How they move

There are no legs, so everything a body says has to be said with a lean, a roll
and a squash. The animation is built out of six weighted states — idle, walking,
at a table, won, lost, about to do something stupid — which are summed rather
than switched, so a friend who wins while walking raises their hands without
stopping dead first.

Under that: springs rather than lerps, so lean and hand height overshoot and
settle instead of sliding into place; squash and stretch that keeps volume, so a
shorter body is a wider one; hands that chase the body rather than being placed
on it, so they trail on a turn; and blinking, at human intervals and sometimes
twice in a row, because a face that is mostly eyes and never blinks is the most
obviously wrong thing that face can do.

The eyebrow is its own model for the same reason. Welded to the skull, the only
thing a character could do was turn round; loose, it drops for a blink, comes
down for a scowl and lifts for a win, and all three read across a room.

`tools/pose-shot.mjs` renders all six states side by side through the real rig.
It is how the walk was caught leaning backwards: the models face -Z, so a
positive rotation about X tips the body the wrong way, and every lean in the set
was pointing behind itself.

## Matching the original

The look here is not invented. It is drawn from the actual game -- Steam app
3892270 -- read off its own screenshots rather than from memory:

- **The characters.** Bowling-pin bodies, no legs, floating mitten hands, eyes
  that take up most of the face, flat pastel colours, and a hat each. An earlier
  pass here modelled realistic adults in suits; they looked fine and belonged to
  a different game.
- **The floors.** Four rooms rather than one repeated: a classic floor in
  oxblood and gold, a black-light room that is all magenta and cyan over purple
  concrete, a cool marble vault, and a gold rotunda. The first pass was warm
  charcoal and gold on all four.
- **The frame.** A fine halftone dither and a vignette into the corners, both of
  which every in-game shot of the original carries. They are CSS layers over the
  canvas, not render passes -- a full-screen pass costs a second draw of the
  frame on a machine that may already be struggling. The first attempt did the
  vignette as a 12rem inset box-shadow, which is recomputed every frame, and it
  cost more than the 3D did: `drive.mjs` went from passing to timing out.
- **The movement.** Run, jump and crouch, and camera smoothing that can be
  turned off, because the original exposes exactly those under Accessibility.

What could not be verified, and so was not copied: the floor names, the UI
typeface, and any of the original's actual movement numbers -- none are
published, and guessing them and calling it a match would be worse than this.

## Whether you can win

You could not. The complaint was "you lose way too easily and never win", and
`tools/economy.mjs` turned it into a number: reading the real config and the
real bet tables, playing four thousand complete runs under three policies, the
old build scored **0% paid off and 100% thrown out, in the median on day
three** — nine days of a twelve-day arrangement that nobody had ever seen.

Four things were wrong, and only one of them was the difficulty curve.

- **The quota was impossible.** 700 growing 62% a day reaches $141,175 by day
  twelve, from a $500 bank, on machines that all take a cut. It is 350 growing
  12% now, topping out at $1,225.
- **Being broke was an absorbing state.** Under the table minimum you cannot
  bet, so you cannot make a quota, so you cannot clear a strike. That is not a
  difficulty curve, it is a dead end, and it ended 99% of runs. The shark
  stakes you now and adds it to the book at a quarter over.
- **Winning was against the rules.** Heat charged four times more for winning a
  hand than for playing one, so any machine an item made profitable shut after
  about four good hands.
- **The items were flavour text.** They are the engine of the run now: each
  names a machine and a percentage it adds to its payouts, applied in one place
  in `resolve`, printed in the shop and again in the odds panel with the
  boosted figure. Plus 2% comps on every stake, stated in the same panel.

Measured after: nobody is thrown out playing carefully, and taking real risks
pays the debt off in 28% of runs. Survive by playing well, win by taking a
swing, and the swing can cost you the run.

## What makes it a game

The tables are the same twelve tables. What changed is that where you play and
how long you stay there now matters more than which bet you pick.

**Heat.** A floor has a memory. Playing a machine warms it and winning warms it
faster; walking away cools it. Warm enough and the house watches; warmer and it
**shortens the odds on that machine to 90% of the board**; warmer still and it
closes for twenty-five seconds. Let the whole floor get hot and two of them take
an elbow each and you are done there for the night — you keep every penny, which
is the point: it costs you time, and time is the currency a five-minute day is
denominated in.

Measured, at one table, on a believable run: watched by the fourth hand, odds
shortened by the seventh, closed by the ninth. About forty-five seconds. So a
day is a tour of five or six tables rather than a grind on one, and a table that
is going well is a table you have to leave.

Two rules it is built on, the same two as the odds themselves. **Everything is
published** — a shortened payout is on the table, in the odds panel and on the
prompt before you bet, and `tools/odds.mjs` audits the cold-table numbers the
panel says it is quoting. And **it is always escapable**: heat only falls while
you are away, and it falls faster than it rises.

**The pit boss.** Heat, made into a person. A number going up in a corner is
something you read; a man in a black suit walking towards the table you are
winning at is something you feel. He doubles whatever he is stood over and he is
slower than you are, on purpose — the answer to him is always to go and play
somewhere else, which is the behaviour the whole layer is trying to produce.

**The floor does things.** Every forty to seventy seconds: a table starts paying
30% over for twenty-six seconds and it is probably across the room; the pit does
a round and every table warms at once; drinks arrive and the next three hands go
unnoticed; a friend is up and will split it if you reach them in time; or the
shark's man arrives early and takes eight percent off the debt whatever you were
doing. Each is announced with its number before it does anything, and none can
be waited out for a better one — the good ones need you to move, the bad ones
happen regardless.

They compose, at the one place money moves. A table you have been grinding that
goes hot pays 0.9 × 1.3 — still over the odds, but less over than the one you
have not touched.

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
node gwyf-web/tools/together.mjs                 # two windows playing together, driven through the interface
node gwyf-web/tools/crew-shot.mjs out.png        # the four friends, assembled as the game builds them
node gwyf-web/tools/pose-shot.mjs out.png        # every pose the animation holds, side by side
node gwyf-web/tools/postcards.mjs                # one shot of every machine from where you stand at it
```

`together.mjs` exists because of a bug it would have caught on day one. The
first multiplayer tests called `GWShell.connect()` straight from the console and
never touched a button; they passed cleanly while the screen those buttons live
on rendered nothing at all — its builder returned `body` where every other
screen returns `html`, so `sheet.innerHTML` was set to `undefined`. The transport
was perfect and the feature did not exist. Nothing in that harness now reaches
past the interface: it clicks Host, types a name, copies the peer code out of one
window and pastes it into the other.

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
  core/      rng, config, run state, audio, the friends, heat, the floor's events
  gfx/       model decoder, HDR environment, stage, physics, cards
  games/     twelve games, one file each, all through one contract
  world/     collision, level generation, the player, the friends' bodies
  ui/        screens, loading, touch controls, mod menu
  net/       the link to another copy of the game, and what is shared over it
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

**The lens is not the renderer's business but it is the biggest thing on this
list anyway.** One camera did two jobs for a long time and the table's lens won:
38 degrees vertical, which frames a coin beautifully and makes walking a casino
feel like being led round it with a toilet roll held to one eye. Walking has its
own 72 now, eased into the table's 38 when you sit down and widened a few
degrees as you get up to speed. Nothing else changed as much per line.

Two rendering faults that no error ever reported, both found by measuring
rather than reading:

- **Every table was a black rectangle.** The lamp that lights a game hung over
  the world origin, from when a game was mounted at the origin and there was
  only ever one. Laid out across a thirty-metre hall, it lit carpet. It hangs
  over the table you are at now, with a fill light where the camera is, because
  overhead alone grazes the upright cabinets — measured, six percent mean
  luminance against forty for the flat ones.
- **Several tables were watched from inside a wall.** Each game says where to
  watch it from, in its own space; four metres in front of a machine standing a
  metre from the wall is three metres into the brickwork. The camera is slid
  back along its own line until it is in the room.

`tools/framing.mjs` is what these cost: it walks to every machine through the
interface, waits for the camera to arrive, and measures how much of the frame
the machine covers and how bright the result is. Both faults were invisible to
every other test, and `tools/drive.mjs` — which is supposed to catch exactly
this — was itself broken: it called `enterFloor(floor, id)`, `enterFloor` takes
a floor, and for months it reported twelve games played while standing in a
corridor, saving black screenshots nobody looked at. It walks up and presses use
now, and fails if a game never takes the money.

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
