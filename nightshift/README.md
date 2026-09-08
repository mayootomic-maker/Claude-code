# Nightshift on Aurora-7

A social deduction game — Among Us, extended — that a class can play from one
file, with no accounts, no installs and no server to run.

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

**Twenty-one tasks**, each a different thing to do rather than five reskinned
progress bars — wiring, a card you have to swipe at the right speed, a
distributor to time, asteroids to shoot, a reactor sequence to memorise, a
sample to wait on, fuel to carry between two rooms.

**Five sabotages.** Reactor and oxygen are on a timer and need two people at
once. Lights shrink what the crew can see and leave the impostors untouched.
Comms take away the task list. Doors seal a room for twelve seconds.

**A meeting built for a classroom.** Text chat with quick phrases, because
nobody is on voice; votes hidden until the vote closes; the dead can read
everything and say nothing to the living.

**Practice bots** that walk to their tasks, stand at them for as long as a
person would, report bodies they can actually see, and kill when they are alone
with somebody. Enough to learn the map, and enough to fill out a small class.

**Fourteen colours and twelve hats**, all drawn rather than sprited.

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
node tools/deal.mjs            # 270,000 role deals against the rules' invariants
```

`drive.mjs` plays a practice round through every screen the game has, opens all
twenty-one tasks, calls a meeting, votes, watches an ejection, and fails on any
console error. `together.mjs` is the one that matters most, because it runs the
half of the game the solo drive cannot: it checks that a guest is dealt a
*sealed* role it can open, that a crewmate guest learns nobody else's, that the
host's settings reach the guest, that walking on one device is visible on the
other, and that a task finished on the guest moves the bar on the host.

Two bugs were found by running these that nothing else would have caught: every
action button showing for crewmates (the `hidden` attribute was losing to a
`display` rule), and two players locked into the same colour because only the
person joining ever re-picked.

`--fragment` is for hosts that supply their own `<html>` and `<body>`. Inside
the claude.ai artifact viewer there is no WebSocket and no WebRTC, so that build
finds other players through the `room` capability instead — which only reaches
signed-in viewers of the same organisation. For a class, send the file.

## Things it does not do, and why

- **No voice chat.** A browser can do it, but a classroom cannot: fourteen open
  microphones in one room is feedback, not a game. The meeting is built around
  typing instead, with quick phrases so it keeps pace.
- **No accounts, no saved stats.** Nothing to sign into means nothing to
  administer, and a game a teacher has to create logins for does not get played.
- **No server.** There is nowhere to run one for free that survives a class of
  thirty, and a public broker plus one host device is enough for what this
  sends.
- **No host migration mid-round.** If the host closes their tab the round ends
  and everyone returns to the lobby, said plainly, rather than the game
  pretending to continue with nobody deciding anything.
