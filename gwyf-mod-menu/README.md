# GambleMenu

An in-game mod menu for **Gamble With Your Friends** — 33 mods across nine categories, 72
configurable settings, named profiles, per-mod hotkeys, five themes, and a set of discovery
tools for reaching the parts of the game this menu does not already know about.

Press **Insert** in game.

---

## Installing

1. Install **BepInExPack 5.4.2305** for this game — through [r2modman], [Gale], or by
   unpacking it into the game folder by hand.
2. Drop `GambleMenu.dll` into `BepInEx/plugins/`.
3. Launch the game and press **Insert**.

If nothing appears, open `BepInEx/LogOutput.log` and look for `GambleMenu`. It logs what it
resolved, what it could not, and why.

[r2modman]: https://thunderstore.io/c/gamble-with-your-friends/p/ebkr/r2modman/
[Gale]: https://thunderstore.io/c/gamble-with-your-friends/p/Kesomannen/GaleModManager/

## Keys

| Key | Does |
| --- | --- |
| `Insert` | Open and close the menu |
| `End` | Panic — switch every mod off at once |
| *(yours)* | Every mod takes its own hotkey; expand a card to bind one |

Both are rebindable in **Settings**. Click a key field, press a key; `Esc` cancels,
`Backspace` clears.

---

## The mods

### Economy — 7
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

### Player — 4
**Noclip** (WASD, Space/Ctrl, Shift to boost) · **Movement tuning** (finds the player's speed
and jump values and scales them) · **Position bookmarks** (four teleport slots) ·
**Position readout**.

### Visuals — 7
Nothing here touches game state, so all of it works as a guest.

**Run readout** (bank, quota, still-needed, floor, time left) · **Player markers** (through
walls, with distance) · **Object finder** (marks anything whose name matches your filter) ·
**Fullbright** · **Remove fog** · **Field of view** · **Crosshair**.

### Automation — 2
**Auto key press** repeats a key on a timer — pointed at a machine, it plays it. It is
deliberately a key repeater rather than an "auto-spin for machine X": the game's seventeen
games of chance are not something this plugin has names for, and a repeater works on all of
them instead of on one that was guessed right. **Timed save backups** copies your save every
few minutes.

### Session — 2
**Lobby readout** and **Why is something greyed out?**, which explains your current role and
lists exactly what it is blocking.

### Developer — 3
The tools that reach past what the menu already knows:

- **Dump the game's classes** — writes every game type, field and method to a text file.
  Also dumps just the loaded scene's components, the live run with current values, and a
  binding report.
- **Live field editor** — read and write *any* field on *any* live object, by name. Find a
  field in a dump, type its class and field name here, and drive it. No rebuild needed.
- **Networked object list** — everything Mirror is syncing, with its components.

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
