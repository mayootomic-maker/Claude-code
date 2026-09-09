# Nightshift on Aurora-7

A social deduction game — Among Us, extended, with ducks — that a class can
play from one file, with no accounts, no installs and no server to run.

Open **`nightshift.html`**. Double-clicking it is the whole setup. One person
presses **Start a game** and reads out the four-letter code; everyone else opens
the same file, types the code and presses **Join**. Or press **Practice with
bots** and play on your own right now.

---

## Getting it to a class

Pick whichever is easiest where you are. All three run the same file.

**Mail or AirDrop the file.** Everyone saves `nightshift.html` and
double-clicks it. It runs straight off the disk. This needs no hosting at all.

**Put it on any static host.** GitHub Pages, Netlify Drop, a school web folder —
drop the one file in and send the link.

**A shared drive.** Anywhere everybody can download from works, since what they
download is the game.

**Games open now.** A host puts its lobby on a shared channel and everybody
else gets a list to tap. Reading a four-letter code out still works and always
will, but four letters across a noisy classroom is four letters mis-heard.

**Two people on one computer, or trying the join flow on your own.** Put
`#local` on the end of the address (`nightshift.html#local`) and open it in two
tabs. They find each other through the browser rather than the network — one
tab hosts, the other types the code. Take the `#local` off to play across
devices again.

The players find each other through a free public MQTT broker over a WebSocket:
`broker.emqx.io`, with HiveMQ and Mosquitto as fallbacks. That is the only
network the game uses, there is nothing to sign into, and if a school network
blocks all three the game says so on screen and a phone hotspot gets around it.

**Be clear about what a public broker is.** It is unauthenticated and open:
anybody who knows the topic can read what is on it. What travels over it is
names, positions, votes and chat. Roles are the exception — see below. Do not
treat the chat as private, and do not put anything on it you would not put on a
whiteboard.

## What is in it, beyond Among Us

**Ten roles.** Crewmate, Engineer (vents), Scientist (portable vitals), Sheriff
(one shot, and it kills you if you are wrong), Medic (one shield for the round),
Detective (reads the trail off a body); Impostor, Shapeshifter (wear somebody
else's face), Phantom (vanish); and the Jester, who wins by being voted out.
Each is a separate chance dial in the lobby, so a class can build the game it
wants and turn off the ones it does not.

**A Play as dial for practice.** The deal is an honest shuffle and stays one:
measured over 270,000 hands, at nine players you are the impostor a shade over
one round in nine, which is exactly right and, played alone against eight bots
for an evening, feels like the game has decided what you are. So a lobby that
is one person and nothing but bots gets a dial next to the bot counter --
Rotate, Random, Impostor, Crewmate. Rotate is the default: it leaves the deal
alone until you have been on the same side twice running, then puts you on the
other one. It disappears the moment a second real person joins, and the host
ignores it, because there would then be somebody it was unfair to.

**Twenty-one tasks**, each a different thing to do rather than five reskinned
progress bars — wiring, a card you have to swipe at the right speed, a
distributor to time, asteroids to shoot, a reactor sequence to memorise, a
sample to wait on, fuel to carry between two rooms.

**Five sabotages.** Reactor and oxygen are on a timer and need two people at
once. Lights shrink what the crew can see and leave the impostors untouched.
Comms take away the task list. Doors seal a room for twelve seconds.

**Somewhere to gather evidence.** The Admin table counts heads per room and
tells you nothing about who. The cameras show four corridors live -- and every
camera on the station blinks while somebody is watching, so it costs you the
one thing an impostor wants to know. Vitals in MedBay says who is still alive.
All three go dark when comms are sabotaged, which is itself information.

**A meeting built for a classroom.** Text chat with quick phrases, because
nobody is on voice; votes hidden until the vote closes, then the whole
breakdown of who voted for whom; the dead read everything, say nothing to the
living, and have a window of their own to say it in. Afterwards, a recap of
what actually happened, in order -- which is the only moment anybody sees the
round whole.

**Bots that argue.** Every bot keeps a memory of what it actually saw — who,
where, when — and nothing else. It cannot see through walls and it does not
read the host's tables. When a body turns up it reasons over the window around
the death: who was near, who is unaccounted for, who it can personally vouch
for. Then it says so, out loud, in the meeting chat:

> **Sol:** I watched Rae do it.
> **Rae:** Tasks in Cafeteria, nothing to report.
> **Ike:** Where were you, Tam? I saw you in a corridor.

An impostor bot keeps the same record and uses it to pick a claim that will not
be contradicted — a room it really was in, before the kill. It watches which way
the room is leaning and leans the same way. It defends itself when named.

Testimony carries: a claim reaches every other bot as evidence, discounted by
how much that listener already distrusts the speaker, which is what stops one
loud liar from steering the room. Nothing a bot says is generated or looked up;
it cannot name a room it was never in. That constraint is the whole point — the
bots can be caught out. `node tools/argue.mjs` stages a murder and prints the
meeting it produces.

**Fourteen ducks and twelve hats**, drawn with paths rather than sprited, so a
colour, a hat and a walk cycle combine freely. What makes one read as a duck at
thirty pixels is not detail: it is a heavy low body, a round head set forward,
a bill that breaks the outline, and a side-to-side waddle nothing else on the
station does. They blink, look about, and quack — the quack is synthesised, and
what sells it is the pitch falling hard over sixty milliseconds with a bandpass
sweeping down alongside it.

**Three cinematics**, for the three beats a table remembers: the kill, the
airlock and being told who you are. Each is a short staged shot — letterbox in,
the killer crossing the gap, the victim going over, feathers — and each is over
in under three seconds, because a flourish you cannot skip is a flourish you
resent by the fourth round. `prefers-reduced-motion` gets the same information
as a held still frame. Colour is
never the only thing telling two people apart: Options turns on a shape per
colour, drawn on the suit and on every portrait.

**A station you can hear.** The room tone drops a fifth and opens up when the
lights go out, so the dark sounds different before you have read the banner,
and everybody else's footsteps carry through walls at a volume that falls off
with distance. Both sides of the game get to use that.

## The dark

The lit area is a polygon raycast against the map every frame, not a circle
pasted over the picture. Walls stop it, so you cannot watch somebody through a
wall, and people are drawn *after* the darkness and clipped to what you can see
— which is why nobody leaves a faint smudge where they are standing in the next
room. About three per cent of the station bleeds through the dark: enough to
remember the layout, far too little to make out a person.

## Roles are the one secret, and they are encrypted

Every transport under this game is a broadcast, so a role sent in the clear is a
role anyone can read with the network tab open — and in a class of thirty, one
person will. So each player generates an ECDH keypair on the way in, publishes
the public half, and the host encrypts each player's role to a separate shared
secret. Votes go to the host the same way and are revealed only when the vote
closes.

Positions, kills and chat are *not* encrypted, because every device has to draw
them. Somebody determined enough to read the wire can see where people are. The
defence is that it takes real work and a round takes ten minutes — not that it
is impossible. Roles are worth protecting because knowing them once ruins every
round; the rest is worth exactly the hundred lines in `src/net/crypto.js`.

## Controls

**WASD** or the arrows to walk. **E** use, **Q** kill, **R** report, **F** your
role ability, **Z** sabotage, **M** map, **T** tasks.

On a phone, touch anywhere in the left half of the screen and a stick appears
under your thumb; the buttons are down the right. Both halves work at once.

## Where things are

```
src/core/     util, the settings table, and every sound (synthesised, no files)
src/world/    the station as rectangles, rasterised to tiles; line of sight
src/net/      MQTT, the artifact room, solo loopback, and the role encryption
src/game/     rules, the authoritative host, the local mirror, sabotage, bots
src/gfx/      characters, the pre-rendered station, particles, the frame
src/ui/       tasks, meeting, HUD, input, screens
build.mjs     inlines all of it into one HTML file
tools/drive.mjs  plays a full round in a real browser and photographs it
```

Rebuild after editing anything under `src/`:

```bash
node build.mjs                 # -> nightshift.html      (the one to send people)
node build.mjs --fragment      # -> nightshift.fragment.html
node tools/drive.mjs           # plays a round in Chromium, fails on any error
node tools/drive.mjs --phone   # the same at phone size
node tools/together.mjs        # two tabs: one hosts, one joins, across the seam
node tools/room.mjs            # the artifact transport, against a stand-in room
node tools/deal.mjs            # 270,000 role deals against the rules' invariants
node tools/argue.mjs           # stages a murder and prints the meeting it causes
node tools/cine.mjs            # photographs the three cinematics mid-shot
node tools/hunt.mjs            # runs whole rounds headless: who dies, who wins
```

`drive.mjs` plays a practice round through every screen the game has, opens all
twenty-one tasks, calls a meeting, votes, watches an ejection, and fails on any
console error. `together.mjs` is the one that matters most, because it runs the
half of the game the solo drive cannot: it checks that a guest is dealt a
*sealed* role it can open, that a crewmate guest learns nobody else's, that the
host's settings reach the guest, that walking on one device is visible on the
other, and that a task finished on the guest moves the bar on the host.

`room.mjs` stands up the room capability locally -- emit/on, presence/onPeers,
peers() with the same shape -- so the artifact transport is exercised outside
the viewer, where `window.claude` does not exist. It proves this game's use of
the contract, not the platform's implementation of it, and it caught two bugs
that would have made the published page look empty to everybody: the lobby
filter and the player's colour were both stored under `c`, and the round could
start before the view knew its own peer id.

`hunt.mjs` runs the host, the pathfinder, the bot minds and the whole round
loop headless at a fixed timestep, with no renderer and every seat played by a
bot, and reports where the murders land and who wins. It exists because "I get
killed every single time" is not a bug report you can act on and not one you
can dismiss either -- and because two different people can be right about the
same feeling for different reasons.

It settled three things. Nobody is hunted: every seat's share of the first
murder is within noise of one over the number of crew, including the seat the
person who opened the lobby sits in, which is where the bias would have been if
there was one. The role deal is fair, and `deal.mjs` measures that separately
over 270,000 hands. And the game *was* rigged against the crew, just not in the
way it felt: a third of all rounds ended in a reactor meltdown, because bots
were freezing in doorways -- see below -- so nobody arrived at the pads. With
that fixed the crew win a bit over half of rounds at the default settings, and
the tasks actually finish.

The bots are worth their own line: they walk to the nearest job they still owe
rather than the first on the list (dealing in order parked seven of them in
Storage at once), they repair a sabotage -- and the two people a meltdown needs
are assigned across the whole crew by who is nearest, not by the parity of a
bot's index, which covered both pads only while the survivors happened to
include both parities -- they walk their fake list if they are lying, and they
leave through a vent after a kill.

The freezing was the worst bug in the game and it was invisible: bots shortcut
their grid path by asking line-of-sight whether they can walk straight to a
further waypoint, and a line-of-sight ray has no width. It slips past a corner
that eleven pixels of duck cannot. The bot pushed diagonally into the wall,
moved nothing, threw the path away, planned the identical path, took the
identical shortcut, and wedged again -- forever. Three of the crew standing
still in a corridor is why the reactor melted down, why the task bar stalled at
two thirds, and why a round so often turned into a massacre. The shortcut is
tested along both flanks of the body now, and a bot that wedges anyway steps
back to the middle of its tile instead of retrying from the same pixel.

Four bugs came out of running these that reading the code did not find. Every
action button showed for crewmates, because `hidden` was losing to a `display`
rule. Two players could be locked into the same colour, because only the person
joining ever re-picked. The two room bugs above. And the worst one: the whole
game ran on `requestAnimationFrame`, so a host who looked at another tab froze
the round for everyone and, five seconds later, vanished from it -- the
authoritative loop is on an interval now, and `together.mjs` measures that a
backgrounded host keeps ticking.

`--fragment` is for hosts that supply their own `<html>` and `<body>`. Inside
the claude.ai artifact viewer there is no WebSocket and no WebRTC, so that build
finds other players through the `room` capability instead — which only reaches
signed-in viewers of the same organisation. For a class, send the file.

## What is not tested here, said plainly

Four of the five ways this runs are exercised by the tools above: solo, two
tabs on one computer, the artifact room against a stand-in, and the rules
themselves. **The public brokers are not.** The container this was built in
blocks outbound WebSockets to all three of them, so the one path a class will
actually use has never been run against a live broker from here.

What that risk is, and is not. The MQTT client itself (`src/net/mqtt.js`) is
the one already carrying `gwyf-web` in this repository against these same three
brokers, unchanged but for its name. Everything above the transport -- the
lobby, the sealed roles, the snapshots, the meeting -- is the same code the
other three transports run, and it is tested. What is untested is the seam
between them: `openMqtt` in `src/net/link.js`, about a hundred and thirty
lines, and whether a school network lets any of the three through.

So try it before the lesson, not during it: open the file on two devices and
join a game. If the brokers are blocked the join screen says so and names the
reason rather than hanging, and a phone hotspot is the usual way round it.

## Things it does not do, and why

- **No voice chat.** A browser can do it, but a classroom cannot: fourteen open
  microphones in one room is feedback, not a game. The meeting is built around
  typing instead, with quick phrases so it keeps pace.
- **No accounts, no saved stats.** Nothing to sign into means nothing to
  administer, and a game a teacher has to create logins for does not get played.
- **No server.** There is nowhere to run one for free that survives a class of
  thirty, and a public broker plus one host device is enough for what this
  sends.
- **No host migration mid-round.** One device decides everything, so losing it
  mid-round is not recoverable: a new host would know nobody's role, because
  roles are sealed to devices rather than stored anywhere. The round ends, says
  why, and the lobby is picked up by whoever is left -- the lowest peer id,
  decided the same way on every device, so nobody has to re-enter a code. In
  the lobby that handover is seamless.
- **Arriving mid-round makes you a spectator.** You walk the station, watch,
  and talk to the other ghosts; the next round deals you in. Being able to do
  nothing is a fine outcome, being told nothing is not.
