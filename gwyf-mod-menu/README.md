# GambleMenu

An in-game mod menu for **Gamble With Your Friends** — 49 mods across eleven categories, 150
configurable settings, named profiles, per-mod hotkeys, five themes, and a set of discovery
tools for reaching the parts of the game this menu does not already know about.

**It also runs in other Unity games.** Roughly two-thirds of what is here needs no knowledge
of any particular title: the menu, the profiles, the visuals, noclip, the machine markers, and
the value finder below — which finds and freezes any number a game is holding without a single
class name being known in advance. Only the economy, quota, floor and save mods are specific
to Gamble With Your Friends, and in another game they are simply not listed.

Press **F1** in game.

---

## Installing

**The easy way:** run **GambleMenu-Installer.exe**. It finds your Steam install (including
libraries on other drives), sets up BepInEx if you do not already have it, installs the
plugin and then checks the result. It leaves an existing BepInEx setup alone, so it is safe
to run alongside r2modman or Gale.

**You can run it while the game is open.** It notices, offers to close the game, install and
launch it again through Steam, and does the whole thing in one go — roughly twenty seconds.
Say no and it installs anyway, ready for your next launch.

This restart is not the installer being cautious about file locks. BepInEx installs itself
into the game at startup by proxying `winhttp`, and it enumerates the plugins folder once,
at that moment. A mod
dropped in mid-session is not loaded until the process restarts, no matter how it got there.
Loading one into a live game means bypassing BepInEx entirely with a Mono injector, which is
a different piece of software with a real chance of crashing the game.

Flags: `--uninstall` removes the plugin and keeps your settings; `--auto` skips the prompts.

**Another Unity game?** If the installer cannot find Gamble With Your Friends it lists every
Unity game in your Steam libraries and lets you pick one. `--game="Some Other Game"` targets a
title by folder name directly. Detection is by shape — an executable beside a `*_Data` folder —
so it works for games it has never heard of.

**By hand:** install **BepInExPack 5.4.2305** through [r2modman] or [Gale], then drop
`GambleMenu.dll` into `BepInEx/plugins/`.

The installer asks which key should open the menu and writes it to the config before the
game ever runs. That matters more than it sounds: every other way in can be defeated — a
keyboard without that key, a game that swallows the press — and none of them can be fixed
from inside a menu you cannot open.

Either way, launch the game — a **"GambleMenu loaded"** banner appears for a few seconds.
That banner is the diagnostic: if you see it, the plugin is running and only the keybind
could be wrong. If you do not, BepInEx never loaded it — check `BepInEx/LogOutput.log`.

[r2modman]: https://thunderstore.io/c/gamble-with-your-friends/p/ebkr/r2modman/
[Gale]: https://thunderstore.io/c/gamble-with-your-friends/p/Kesomannen/GaleModManager/

## Keys

| Key | Does |
| --- | --- |
| `F1` | Open and close the menu |
| `Insert` | Does the same — a second key, in case one is taken |
| `End` | Panic — switch every mod off at once |
| `Esc` | Closes the menu |
| *(yours)* | Every mod takes its own hotkey; expand a card to bind one |

**Two open keys, not one.** Insert was the original default and it was the wrong choice:
most laptops, and every TKL or 60% keyboard, either hide it behind `Fn` or leave it off
entirely. F1 is on every keyboard ever made, so it leads.

**No key at all?** A small **MENU** tab sits at the edge of the screen and opens the menu when
clicked. It disappears once you have opened the menu once, and can be set to always-on or off
in Settings. It is not a full substitute — while the game holds the cursor for looking around,
nothing on screen is clickable — so it helps in menus rather than mid-spin. The reliable route
is a key, which is why there are two and why the installer lets you set one up front.

The menu key is read from Unity's own event stream rather than from an input API, so it
works whether the game enabled the legacy input manager, the Input System package, or both.

Both are rebindable in **Settings**. Click a key field, press a key; `Esc` cancels,
`Backspace` clears.

---

## The mods

### Economy — 9
The shared bank account and the loan shark's demand.

| Mod | What it does |
| --- | --- |
| **Pinned balance** | Holds the bank at a fixed number so nothing you spend moves it |
| **Adjust balance** | Set, add, double or clear the bank, once |
| **Winnings multiplier** | Tops up every gain so it lands multiplied — optionally losses too |
| **Loss protection** | Refunds losses, in part or in full, the moment they land |
| **Minimum balance** | Never lets the bank drop below your number |
| **Freeze quota** | Stops the daily demand ramping and holds it where you say |
| **Adjust quota** | Set today's demand, or top the bank up to exactly cover it |
| **Lucky streak** | Quietly turns some losses into wins, at believable sizes |
| **Slow drip** | Walks the bank toward a target in payout-sized steps instead of setting it |

#### Looking like luck rather than an edit

**Lucky streak** and **Slow drip** exist because the blunt mods are obvious. Three things
give a money mod away to anyone watching the shared bank: the numbers are round, the size is
wrong for the stakes in play, and it happens instantly. Both mods fix all three — payouts are
jittered off round figures, sized against the *current quota* so they stay proportionate as
the run scales, and paid out over time.

Lucky streak also refuses to be perfect: it caps how many losses in a row it will rescue and
rests between saves, because nobody wins nine hands running. Set "loss becomes a win" to 1.00
and you never lose, which is precisely what gives it away — around half reads as a good night.

Worth being straight about the ceiling: this changes how *plausible* a change looks, not
whether it is visible. Anyone reading the bank still sees the number move. What they will not
see is a round trillion appearing between two frames.

### Machines — 2
Marking machines, and the spots on them.

#### Outcome mapper — where the losing one is

Everything else here reads *numbers*. This reads **positions**, which is what actually answers
"which of these is the bad one".

A machine that has already chosen its outcome almost always holds a reference to the object it
chose — a slot, a segment, a card — or an index into a list of them. That reference is a place
in the world, so it can simply be drawn on. Two shapes cover nearly every casino machine ever
written, and this looks for both:

```
Wheel.winningSegment      -> a field pointing straight at the chosen thing
Reel.symbols[resultIndex] -> a list of candidates plus an index into it
```

Which pointer means *good* and which means *ruin* is not knowable in advance, so it does not
guess — it **learns**. Each time a marker moves, it watches what the balance does next and
keeps that marker's record. After a few rounds the markers colour themselves:

| | |
| --- | --- |
| **red pin, ✗** | this spot has preceded losses |
| **green pin, ✓** | this spot has preceded gains |
| **amber pin, ·** | not seen enough times yet |

#### How the markers are drawn

Coloured boxes around objects with a text plate on each one is the visual language of an ESP
cheat, and for a good reason: a screen-space rectangle belongs to the *screen*, not to the
world — it is drawn around whatever happens to be behind it.

So markers are a **ring on the floor**, projected through the camera so it lies flat in the
room and tilts with your view, and a **pin** hanging above with an icon rather than a
sentence. Distant markers shrink and fade instead of stacking up at full strength, and only
the **nearest** one is captioned — labelling all of them at once is what turns an overlay into
a wall of text.

The same treatment applies to player markers, the object finder and the machine markers, so the
whole overlay reads as one thing. A `Box` style remains available per mod if you prefer the
old look.

Set *Rounds before colouring* to say how much evidence you want before it commits. Lower reacts
faster and is wrong more often.

In a game with no money binding, name any rising value under *Outcome comes from* as
`Class.field` — score, chips, anything that goes up when you win — and it learns against that
instead.

The honest limit is the same as ever: this reads a decision the game has already made. Where a
machine picks its result up front and then plays an animation, you will see the answer before
the animation admits it. Where the pick happens at the very end, there is nothing to read early
and the marker appears with the result rather than before it.

#### Random state

Where a game rolls through `UnityEngine.Random`, the generator's entire state is a value you can
copy and put back — so a round can be replayed from the point it was decided. Save the state,
spin, and if it went badly restore it and burn a value or two so the next roll comes from a
different place in the stream.

Plenty of games do not use it: a `System.Random` instance, a hand-rolled generator or a
server-side roll are all common and none are touched by this. That cannot be detected from
outside, so there is a button that confirms the generator round-trips, and the real test is a
spin — save, spin, restore, spin again, and see whether the result repeats.

#### Machine markers

Outlines nearby machines where they stand and pins a small panel to each
one showing what its state is doing. Three states, readable without reading:

| | |
| --- | --- |
| **grey** | idle — nothing about this machine is moving |
| **amber** | its state is actively changing right now |
| **green, ringed, PRESS** | your signal condition holds |

**How it finds machines.** No class names are involved. Scenery has no custom script on it, so
anything nearby with a collider, a renderer and a MonoBehaviour from the game's own assembly
is a candidate — and anything whose state never moves is dropped.

**How it picks what to show.** By watching, not by guessing. An earlier version ranked fields
by whether the name looked like `result` or `payout`, which is why it was inaccurate: every
machine has a `value` and most of them mean nothing. This one scores a field on observed
behaviour — never changes means scenery, changes on every single sample means an animation or
a clock, and what is worth seeing sits between those, moving in discrete jumps and having
moved recently.

**Making it say PRESS.** The one thing the mod cannot work out is what a value *means*. So you
tell it, once: set **Signal: field** to the name shown on the marker, pick a comparison, give
it a number. From then on that machine is ringed and labelled whenever the condition holds:
`multiplier` **is at least** `4`, or `roundState` **changes**. The label is yours to write.

Worth being straight about the limit: this reads state that exists. Where a machine rolls its
result up front and then plays an animation, that result is in a field and you will see it
before the animation admits it. Where the roll happens at the end, there is nothing to read
early and no mod can invent it — you will watch the value resolve instead.

### Time — 3
**Day length** (seconds per run in the casino) · **Freeze the day clock** (hold the countdown,
either where it is or at a set time) · **Game speed** (0.1×–5× simulation speed).

### Progression — 3
**Floor access** (jump to any floor, or clear the quota gating the next one — the real
ceiling is read from the game's own floor table, not guessed) · **Hold current floor** ·
**Days survived**.

### Saves — 2
**Save file editor** writes money, quota and floor straight into a slot on disk — permanent,
and applied the next time that slot loads. **Save backups** makes timestamped copies and
restores the newest.

### Player — 6
**Noclip** (WASD, Space/Ctrl, Shift to boost) · **Movement tuning** (finds the player's speed
and jump values and scales them) · **Position bookmarks** (four teleport slots) ·
**Position readout**.

**Free camera** unhooks the camera and flies it. It moves the real camera rather than spawning
a second one — a new camera has to be told the original's culling mask, clear flags, projection
and post-processing stack to look remotely the same, and gets all of it wrong on a pipeline it
was not written for. Parent and local transform are restored exactly on exit.

**Third person** pulls the camera off your head, adjustable back/up/sideways. Applied in
LateUpdate, because a game moves its own camera in Update and an offset applied before that is
overwritten in the same frame.

### Visuals — 7
Nothing here touches game state, so all of it works as a guest.

**Run readout** (bank, quota, still-needed, floor, time left) · **Player markers** (through
walls, with distance) · **Object finder** (marks anything whose name matches your filter) ·
**Fullbright** · **Remove fog** · **Field of view** · **Crosshair** · **Zoom** (hold a key for a
spyglass) · **Hide the game's interface** (F11, for a clean look — toggles canvases rather than
destroying anything, and optionally hides this menu's overlay too).

### Performance — 1
Frames per second. Local rendering only, so it is safe in a lobby and safe as a guest.

**Performance boost** turns down what costs the most, with three presets — *Light* barely
changes the look, *Aggressive* looks worse and runs a great deal faster — or set each lever
yourself: shadows, VSync, the frame cap, post-processing, live reflections, soft particles,
anti-aliasing, texture detail, **render scale**, detail distance and view distance. An FPS
readout goes on screen so you can see what each change actually bought.

Render scale is the strongest lever and the most visible: it renders below your display
resolution and scales up. It is applied to the URP pipeline asset through reflection rather
than a package reference, because a hard reference to URP would stop the whole plugin loading
in a game that uses the built-in pipeline.

Everything is captured on enable and **restored on disable**. Without that, trying this once
would leave shadows off and quarter-resolution textures in every session afterwards with
nothing to blame.

One lever is deliberately missing. `fixedDeltaTime` is the cheapest frames in Unity and the
one thing here that must not be touched: it changes how often physics steps, which on a host
changes the simulation every other player is synchronised to.

### Automation — 4
**Auto key press** repeats a key on a timer — pointed at a machine, it plays it. It is
deliberately a key repeater rather than an "auto-spin for machine X": the game's seventeen
games of chance are not something this plugin has names for, and a repeater works on all of
them instead of on one that was guessed right. **Timed save backups** copies your save every
few minutes.

**Press on a good signal** fires your key the moment the outcome mapper marks a spot whose
record shows gains — it reads that mod's verdict rather than deriving a second one, so there is
only ever one definition of a good result in play. A configurable pause before pressing keeps it
from reacting faster than a person could.

**Key sequence** repeats a list of keys with delays (`E 1.0, Space 0.5`) for rounds that take
more than one button. A bad token is named rather than quietly skipped.

### Session — 2
**Lobby readout** and **Why is something greyed out?**, which explains your current role and
lists exactly what it is blocking.

### Developer — 4
The tools that reach past what the menu already knows:

#### Value finder — the one that works anywhere

Search-and-narrow, the way a memory scanner does it, but over managed reflection instead of
raw addresses.

1. Type a number you can see in game — your balance, your health, an ammo count.
2. **First scan.** Every numeric field in the scene is checked; a few thousand usually match.
3. Change it in game, then narrow: **= value**, **changed**, **unchanged**, **increased**,
   **decreased**.
4. Repeat twice more and you are usually down to one or two.
5. **pin** it to the on-screen readout, **freeze** it where it is, or **set** it to anything.

Reflection beats address scanning on every axis that matters here: survivors come back with
real class and field names (`PlayerWallet.balance`, not `0x7FF6A2C41B08`), nothing has to be
re-found after a reload, and writes go through the runtime rather than into whatever happens to
sit at an address.

Do not know the number? Scan for **every number** instead and narrow with increased/decreased
alone — the standard trick for a value you can only see move, like a hidden timer or a
concealed stat.

This is the reason the menu is worth installing in a game nobody has mapped. No bindings, no
dump, no class names. If the game keeps it in a field, this finds it.

- **Dump the game's classes** — writes every game type, field and method to a text file.
  Also dumps just the loaded scene's components, the live run with current values, and a
  binding report.
- **Live field editor** — read and write *any* field on *any* live object, by name. Find a
  field in a dump, type its class and field name here, and drive it. No rebuild needed.
- **Networked object list** — everything Mirror is syncing, with its components.
- **Method caller** — call any method in the game by name, with arguments. The natural partner
  to the class dump: where the field editor changes what a value *is*, this runs what the game
  *does* about it, which is usually the difference between a number that looks right and a game
  that has actually noticed. Arguments are converted to whatever the overload expects.
- **Component switch** — find scripts by name and switch them off individually. The blunt
  instrument for a script that fights the camera, resets a value every frame, or plays an
  animation you would rather skip. It only toggles `enabled`, never destroys, and everything
  goes back on when the mod is switched off.
- **Value graph** — plots any field over time as a sparkline. A number tells you what it is now;
  a line tells you what it *does* — whether a multiplier climbs smoothly or in steps, where the
  spikes are. That shape is invisible in text.

---

## Playing with friends

The game is co-op over **Mirror**, with a server-authoritative simulation: the host's machine
owns the money, the quota and the floor.

That makes a whole class of "mod" not merely rude but broken. Writing the balance from a
guest does not give the table money — the host's value is the real one, so your write is
either overwritten on the next sync or it desyncs the run for everybody. So mods that touch
shared state are marked **host** and refuse to run when you are a guest, with the reason on
the card. Local mods — every visual, the HUD, noclip, the crosshair — work regardless.

A few mods are marked **solo** because they would spoil the run for others rather than
enhance it. Game speed is one: on a host, time scale drags the whole lobby along with it.

You can turn the guard off in **Settings → Respect server authority**. It does not make those
mods work; it makes them desync the lobby, and the setting says so.

---

## Surviving game updates

**Nothing in this plugin is compiled against the game.** There is no reference to
`Assembly-CSharp`. Every game type, field and method is looked up by name when the game
loads.

That is a deliberate trade. A hard reference is tidier to write and pins the plugin to one
build of the game — the next patch turns it into a crash on startup. Looked up by name, a
renamed field costs you *one mod*, which greys out and says which binding it wanted.

The **Compatibility** page shows all 23 bindings, resolved or not, what each is for, and what
it actually bound to. It is the first place to look when something is greyed out.

The member names came out of a shipped, MIT-licensed mod for this game
([SaltedByte/sandboxmode]) rather than guesswork, so the economy and timing hooks are
known-good against the build that mod targets.

[SaltedByte/sandboxmode]: https://github.com/SaltedByte/sandboxmode

### In another game

Mods whose game hooks cannot resolve are **hidden**, not greyed out — otherwise the
title-specific ones would be permanent dead weight in a game they were never written for.
Turn on *Settings → List unsupported mods* to see them and why. The Compatibility page always
accounts for all of them regardless.

What carries over unchanged: the whole menu, profiles and themes; fullbright, fog, FOV,
crosshair, player and object markers; noclip, movement tuning, bookmarks; game speed; the
machine markers; and the entire Developer tab, value finder included.

### Three tiers of certainty

Worth knowing which is which:

- **Named bindings** — day length, the quota calculation, save-file fields, floors. Read from
  a working mod's source. These are as solid as anything can be without the game in hand.
- **Found by shape** — the live run state, the local player. Located by asking "which object
  owns a field of type `SaveData`" rather than by name, because the type graph changes far
  less often than field names do.
- **Pure engine** — fullbright, fog, FOV, crosshair, noclip, markers, HUD. No game knowledge
  involved; these work on any build.

If a mod you want is missing, the Developer tab is the answer: dump the classes, find the
field, drive it with the live field editor.

---

## Settings and profiles

Everything lives in `BepInEx/config/GambleMenu/`:

```
active.json          current settings, saved when the menu closes
profiles/*.json      named profiles
dumps/               whatever the Developer tab writes
```

A **profile** captures every setting and every mod option — useful for keeping a quiet
quality-of-life set apart from a full sandbox set. Save, load, overwrite and delete from the
Profiles page.

Save-file edits back the file up first (`Settings → Back up a save before editing it`,
on by default). Backups are timestamped rather than rolling, because the mistake you need to
undo is usually noticed several edits later.

**Interface**: five themes (Midnight, Slate, Casino, Paper, Contrast), a free accent colour,
0.7×–1.8× scale, adjustable opacity, and animations you can switch off. The window is
draggable and resizable and remembers where you left it. Contrast is a genuine
high-contrast palette — borders and controls lift with the text, not just the text.

---

## Building

Needs the .NET SDK. No game install required — that is the point of the reflection design.

```bash
./scripts/build.sh          # fetches BepInEx refs, runs tests, builds, zips for Thunderstore
```

On Windows, to build and drop straight into a local install:

```powershell
.\scripts\deploy.ps1 -GameDir "C:\...\Gamble With Your Friends"
```

Tests cover the save-file rewriting, which is the one piece of logic here that can damage
something you care about:

```bash
dotnet run --project tests/GambleMenu.Tests/GambleMenu.Tests.csproj
```

---

## Known limits

- **The 17 games of chance are not individually hooked.** Their internals are not a binding
  this plugin has. The winnings multiplier and loss protection work on *any* of them by
  watching the balance instead — which cannot tell a jackpot from a refund, and says so.
- **Guests cannot change shared state.** Not a limitation of this menu; see above.
- **A save-file edit is not a live edit.** It applies the next time that slot loads.
- **Day length looks wrong to guests.** The host decides when the day ends, but each guest's
  clock reads its own vanilla number until then.
- **Synthetic keypresses need the Input System backend.** Auto key press reports honestly and
  switches itself off if the game uses the legacy input manager, which cannot be driven from
  a mod.
- **Mixed versions are not supported**, as with any gameplay mod — everyone in a lobby wants
  the same one.
