# Reference Analysis — `koenigsegg_reference.mp4`

Prepared before any Blender work, per the brief's Rule 1.

## 1. Container facts (measured, not assumed)

| Property | Value |
|---|---|
| Resolution | 1920 × 1080 |
| Frame rate | 60 fps (constant; `r_frame_rate` = `avg_frame_rate` = 60/1) |
| Duration | 16.600 s video / 16.640 s container |
| Frame count | **996** |
| Video codec | HEVC, yuv420p, ~968 kbps |
| Audio | AAC stereo, 64 kbps (music bed; no diegetic sound needed for the recreation) |

Timeline target for Blender: **frame 1 → 996 at 60 fps**.

## 2. What the reference actually is

This is **not** a studio automotive commercial. It is a hand-held, real-world
capture of a **Koenigsegg Jesko Attack** (purple/violet candy over exposed
carbon, tan/champagne centre stripe, plate `SPS`) at a car event, cut fast to
music. The large rear wing identifies it as the Attack rather than the
long-tailed, wingless Absolut. Two distinct physical locations are intercut:

- **Location A — outdoor plaza.** Overcast white sky, wet tarmac, dense crowds
  of spectators with phones and cameras, trees, a classical building with red
  banners, a modern glazed exhibition hall, traffic cones, event flags.
- **Location B — indoor exhibition hall.** Bare concrete columns and walls,
  tall industrial windows blowing out to white, circular ceiling downlights,
  polished screed floor, `CARNA` flag banners, `DDD performance` black display
  panels, `SPS` printed wall strips, black rope stanchions, other cars parked
  behind.

Cutting rhythm is extremely regular: **~0.70 s per shot** (40–45 frames), with
exactly one long shot (S05, 1.48 s) and a black outro hold (S22, 0.95 s).

Shot detection was run at two thresholds (`scene > 0.10` and `scene > 0.04`);
both give the same boundaries, with sub-frame duplicates collapsed. The
apparent 1.48 s gap at 3.00–4.48 s was checked frame-by-frame and confirmed to
be **one continuous shot**, not a missed cut.

### Global look

- **Exposure/contrast:** flat-ish, slightly lifted blacks, highlights allowed to
  clip on the overcast sky and the indoor windows. Reads like a log-ish profile
  with a gentle contrast curve applied — not a crushed, high-contrast grade.
- **Colour:** cool-neutral outdoors (overcast daylight, ~6500 K); indoors a
  touch warmer on the floor with cool window spill. Body colour reads as a deep
  violet/aubergine that shifts toward blue-black at grazing angles and toward
  magenta where light hits square.
- **Paint construction (important):** the body is **candy purple over visible
  carbon weave**. In several macros (S10, S11, S13) the twill weave is clearly
  readable *through* the coloured clearcoat. This is not a solid metallic — it
  must be built as tinted transparent coat over a carbon base.
- **Depth of field:** aggressively shallow on every detail shot; background
  reduced to soft luminance blobs. The wide shots are noticeably deeper but
  still not pan-focus.
- **Camera motion:** almost every shot is a slow lateral truck/dolly with a
  slight handheld float. No whip pans, no zooms, no crane moves. The car is
  **stationary** in every shot.
- **Transitions:** **hard cuts throughout**. No dissolves, no wipes, no speed
  ramps detected.

## 3. Shot list

Frame numbers are 0-based on the source; the Blender timeline uses 1-based
equivalents (`+1`).

---

### S01 — 0.000 → 0.933 s · 56 f · Outdoor
- **Visible part:** Front three-quarter, from front-left. Nose, left headlight,
  bonnet with tan stripe, windscreen, left front wheel arch, front splitter.
- **Camera position:** Low, ~0.7 m, ~4 m out from the nose, ~35° off the
  centreline to the car's left.
- **Focal length:** ~50 mm. Mild compression; the crowd behind is a readable
  but not flattened band.
- **Movement:** Slow truck right; the dark pillar occluding the left edge
  slides out of frame as the nose settles centre-right. Light handheld float.
- **Focus target:** Left headlight / nose leading edge.
- **DOF:** Moderate — car sharp, crowd 8–12 m behind clearly soft. ~f/2.8 look.
- **Lighting/reflections:** Overcast dome. One broad, soft horizontal sky
  reflection runs the length of the bonnet; the headlight DRL ring reads as a
  bright cool arc. No hard specular.
- **Environment:** Concrete pillar (foreground left, near-black, defocused),
  crowd, parked dark saloon, pink floral display, distant glazed building,
  white blown sky, wet tarmac with soft reflections.
- **Transition out:** Hard cut.

### S02 — 0.933 → 1.667 s · 44 f · Outdoor
- **Visible part:** **Whole car**, front-three-quarter to near side-on. Hero
  establishing shot. Rear wing, side profile, both left wheels, front aero.
- **Camera position:** Low, ~0.5 m, ~7 m out, roughly level with the sill line.
- **Focal length:** ~28–32 mm. Widest lens in the film; noticeable perspective
  stretch on the near front wheel.
- **Movement:** Camera arcs left-to-right around the front while the operator
  walks; the car rotates in frame from side-on toward front-three-quarter.
- **Focus target:** Front wheel / A-pillar.
- **DOF:** Deepest in the film. Background trees and buildings soft but legible.
  ~f/4 look.
- **Lighting/reflections:** Big sky gradient down the flank; a long, unbroken
  bright band along the shoulder line from the open sky, breaking at the door
  shut line. Underbody and wheel wells fall to near-black.
- **Environment:** Exhibition buildings, tree line, pink floral display, event
  flags, photographers, traffic cone, wet tarmac.
- **Transition out:** Hard cut.

### S03 — 1.667 → 2.367 s · 42 f · Outdoor
- **Visible part:** Left front wheel — full carbon five-spoke, carbon-ceramic
  disc, caliper, tyre sidewall, wheel arch above, splitter/canard bottom-left.
- **Camera position:** Very low, ~0.35 m, ~1.2 m from the wheel, near
  perpendicular to the car's side.
- **Focal length:** ~100–120 mm.
- **Movement:** Slow truck right; the wheel drifts left across frame.
- **Focus target:** Spoke face / caliper.
- **DOF:** Shallow — the far side of the tyre and the background are well soft.
  ~f/2.5 look.
- **Lighting/reflections:** Sky wraps the top of the arch as a soft crescent;
  the disc face catches a cool low-contrast sheen. Carbon spokes read almost
  matte with a faint grazing sheen.
- **Environment:** Wet tarmac, kerb, defocused pale building band.
- **Transition out:** Hard cut.

### S04 — 2.367 → 3.000 s · 38 f · Outdoor
- **Visible part:** Rear three-quarter from behind-left. Rear wing, full-width
  taillight bar, rear deck, `SPS` plate, exhaust exit, left rear wheel.
- **Camera position:** ~1.1 m high, ~3.5 m behind, ~30° off the rear centreline.
- **Focal length:** ~40–50 mm.
- **Movement:** Slow truck right / slight push. A photographer's dark silhouette
  enters the right edge as a foreground occluder near the end of the shot.
- **Focus target:** Taillight bar.
- **DOF:** Moderate; crowd soft. ~f/2.8.
- **Lighting/reflections:** Taillight emits a saturated red arc — the strongest
  colour accent in the film. Sky reflects as a broad soft sheet across the rear
  deck and engine cover glass.
- **Environment:** Road markings, crowd, glazed building, red event banner,
  parked vans, trees.
- **Transition out:** Hard cut.

### S05 — 3.000 → 4.483 s · **89 f — longest shot** · Outdoor
- **Visible part:** Left rear haunch and taillight, tight. Rear wing upper
  surface top of frame, diffuser and rear tyre bottom.
- **Camera position:** Low, ~0.8 m, ~1.5 m from the haunch.
- **Focal length:** ~50 mm.
- **Movement:** Sustained truck right across the whole shot — a dark vertical
  pillar occupies the left edge at the start and the haunch travels rightward,
  revealing the diffuser. The slowest, most deliberate move in the film.
- **Focus target:** Taillight / haunch shoulder.
- **DOF:** Moderate-shallow; the line of spectators behind is soft but their
  poses are readable. ~f/2.8.
- **Lighting/reflections:** A single long horizontal sky highlight rakes the
  haunch and defines the shoulder. Red taillight glow spills onto the paint
  immediately around it.
- **Environment:** Dark pillar (foreground left), row of spectators, wet
  tarmac, classical building, trees.
- **Transition out:** Hard cut. **This is the cut from Location A to B.**

### S06 — 4.483 → 5.167 s · 41 f · **Indoor**
- **Visible part:** Whole car, front-three-quarter from the left.
- **Camera position:** ~1.2 m high, ~6 m out.
- **Focal length:** ~35 mm.
- **Movement:** Truck right; strong parallax between the foreground stanchion
  post, the car, and the background columns.
- **Focus target:** Front wheel / door.
- **DOF:** Deep-ish; background legible. ~f/4.
- **Lighting/reflections:** Broad soft toplight from the ceiling plus a large
  bright window wash from the left, producing a long clean highlight down the
  flank. Floor bounce lifts the sills.
- **Environment:** Concrete columns and wall, `CARNA` flag, `DDD performance`
  black panel, black stanchion posts, white car behind, tall windows.
- **Transition out:** Hard cut.
- **Note:** In the last frames a raised dihedral door edge becomes visible at
  frame right. Doors read closed in S17 and clearly open in S20, so the car is
  opened at some point between those two indoor setups. Treated as **static per
  shot** (door closed for S06/S17, open for S20/S21) rather than animated.

### S07 — 5.167 → 5.867 s · 42 f · Outdoor
- **Visible part:** Rear wing blade and upright, tight macro — carbon twill,
  fastener heads, trailing edge.
- **Camera position:** Just above wing height, ~0.5 m away.
- **Focal length:** ~135 mm.
- **Movement:** Very slight drift right.
- **Focus target:** Fastener row on the wing upper surface.
- **DOF:** Very shallow — background is pure luminance blobs. ~f/2.
- **Lighting/reflections:** Grazing sky light across the weave; the twill
  reads as fine parallel highlight ridges. Trailing edge picks up a thin
  bright rim.
- **Environment:** Unrecognisable soft crowd and building shapes.
- **Transition out:** Hard cut.

### S08 — 5.867 → 6.533 s · 40 f · Outdoor
- **Visible part:** Rear quarter / exhaust shroud with `Akrapovič` moulding,
  `JESKO` script, chrome trim edge, purple bodywork above.
- **Camera position:** Low, ~0.5 m, close.
- **Focal length:** ~135 mm.
- **Movement:** Slight drift.
- **Focus target:** `Akrapovič` lettering.
- **DOF:** Very shallow. ~f/2.
- **Lighting/reflections:** A bright chrome highlight strip cuts diagonally
  across the top; the matte black shroud takes almost no specular, giving
  strong material contrast against the glossy paint.
- **Environment:** Heavily defocused people, pale ground.
- **Transition out:** Hard cut.

### S09 — 6.533 → 7.267 s · 44 f · **Indoor**
- **Visible part:** Front wheel — carbon spokes, gold/champagne `Koenigsegg`
  caliper, drilled disc, Michelin `Pilot Sport Cup 2` sidewall lettering,
  carbon splitter edge.
- **Camera position:** Low, ~0.4 m, ~1.2 m out.
- **Focal length:** ~100 mm.
- **Movement:** Slow truck left; a white/silver bollard occludes the right edge.
- **Focus target:** Caliper text.
- **DOF:** Shallow. ~f/2.5.
- **Lighting/reflections:** Cool window light from the left rakes the tyre
  shoulder; the caliper is the warmest element in frame.
- **Environment:** Polished floor, bollard, dark defocused hall.
- **Transition out:** Hard cut.

### S10 — 7.267 → 7.967 s · 42 f · **Indoor**
- **Visible part:** Bonnet / front wing crown with the Koenigsegg ghost badge.
- **Camera position:** Above bonnet height, looking down at ~25°, close.
- **Focal length:** ~135 mm.
- **Movement:** Slight drift left.
- **Focus target:** Ghost badge.
- **DOF:** Very shallow. ~f/2.
- **Lighting/reflections:** **The signature material shot.** Circular ceiling
  downlights reflect as crisp, small, round specular dots across the panel, and
  the carbon twill is plainly visible *through* the purple candy coat. Any
  recreation must reproduce both the point-source dots and the sub-surface
  weave.
- **Environment:** Only reflections.
- **Transition out:** Hard cut.

### S11 — 7.967 → 8.717 s · 45 f · **Indoor**
- **Visible part:** Koenigsegg shield badge on a carbon panel.
- **Camera position:** Level with the badge, very close.
- **Focal length:** ~150–180 mm.
- **Movement:** Slight drift.
- **Focus target:** Badge face.
- **DOF:** Extremely shallow — a blown-white window band fills the top third.
  ~f/1.8.
- **Lighting/reflections:** Strong backlight from the window creates a bright
  band above; the badge's chrome bezel and chequer pattern catch it.
- **Environment:** Blown white window only.
- **Transition out:** Hard cut.

### S12 — 8.717 → 9.350 s · 38 f · **Indoor**
- **Visible part:** Cabin through the side glass — steering wheel with
  Koenigsegg centre, carbon dash, seat, door card.
- **Camera position:** Just outside the door glass, ~1.2 m.
- **Focal length:** ~85 mm.
- **Movement:** Slight drift.
- **Focus target:** Steering wheel centre boss.
- **DOF:** Shallow. ~f/2.
- **Lighting/reflections:** A bright reflection band runs across the upper
  glass, partially veiling the interior — the interior is much darker than the
  exterior and reads mostly in shadow with a few specular edges.
- **Environment:** Reflected hall visible in the glass.
- **Transition out:** Hard cut.

### S13 — 9.350 → 10.050 s · 42 f · Outdoor
- **Visible part:** `JESKO` script on the rear quarter, chrome mirror stalk top
  of frame, body shut lines.
- **Camera position:** Level with the script, ~0.8 m out.
- **Focal length:** ~135 mm.
- **Movement:** Slow drift right.
- **Focus target:** `JESKO` script.
- **DOF:** Very shallow. ~f/2.
- **Lighting/reflections:** Long, soft, low-frequency environment reflections
  smear horizontally across the panel; carbon weave readable through the candy
  coat again. The chrome stalk is the brightest specular.
- **Environment:** Only smeared reflections.
- **Transition out:** Hard cut.

### S14 — 10.050 → 10.750 s · 42 f · **Indoor**
- **Visible part:** Centre-lock wheel nut — brushed metal hex with Koenigsegg
  engraving, carbon spokes radiating out.
- **Camera position:** On-axis with the hub, very close.
- **Focal length:** ~180 mm (tightest shot in the film).
- **Movement:** Slight drift left.
- **Focus target:** Engraved nut face.
- **DOF:** Extremely shallow — spokes fall off within centimetres. ~f/1.8.
- **Lighting/reflections:** Single soft key from upper left; the brushed metal
  shows anisotropic streaking, the carbon nearly black with faint sheen.
- **Environment:** None — fully filled by the wheel.
- **Transition out:** Hard cut.

### S15 — 10.750 → 11.483 s · 44 f · Outdoor
- **Visible part:** Carbon door mirror in silhouette, rear wing behind.
- **Camera position:** Level with the mirror, ~0.6 m out, shooting past it into
  the plaza.
- **Focal length:** ~85–105 mm.
- **Movement:** Truck right; the mirror travels right across frame.
- **Focus target:** Mirror shell / rivets.
- **DOF:** Very shallow — the entire plaza is a soft wash. ~f/2.
- **Lighting/reflections:** Backlit against a bright overcast plaza; the mirror
  is a dark shape with a bright rim and a soft reflection of the sky in its
  glass. Highest subject/background luminance contrast in the film.
- **Environment:** Trees, classical building with red banner, spectators,
  traffic cones, wet ground — all heavily defocused.
- **Transition out:** Hard cut.

### S16 — 11.483 → 12.200 s · 43 f · Outdoor
- **Visible part:** Left front wing and headlight, from front-left low.
- **Camera position:** Low, ~0.5 m, close to the wing.
- **Focal length:** ~50–85 mm.
- **Movement:** Slight drift.
- **Focus target:** Headlight DRL blade.
- **DOF:** Shallow. ~f/2.2.
- **Lighting/reflections:** The DRL reads as a cream/yellow-white blade with an
  iridescent lens flare of colour across the projector optics. Grille mesh sits
  in deep shadow beneath.
- **Environment:** Defocused crowd, classical building, trees.
- **Transition out:** Hard cut.

### S17 — 12.200 → 12.867 s · 40 f · **Indoor**
- **Visible part:** Whole car, front three-quarter, near head-on.
- **Camera position:** ~1.3 m high, ~6 m out.
- **Focal length:** ~40–50 mm.
- **Movement:** Truck; the black stanchion post sweeps across the right of frame
  with strong parallax.
- **Focus target:** Front splitter / nose.
- **DOF:** Moderate. ~f/3.5.
- **Lighting/reflections:** Ceiling downlights produce a row of small specular
  dots along the bonnet crown; the tall windows behind blow to white and create
  a large soft reflection in the windscreen.
- **Environment:** `CARNA` flag, `SPS` wall strips, black display panels,
  concrete wall and columns, stanchions, screed floor, seated staff.
- **Transition out:** Hard cut.

### S18 — 12.867 → 13.533 s · 40 f · **Indoor**
- **Visible part:** Front three-quarter low and close — front wheel, wing, sill,
  mirror, side intake.
- **Camera position:** Very low, ~0.35 m, ~2.5 m out. Aggressive hero angle.
- **Focal length:** ~35 mm.
- **Movement:** Slow push/truck right.
- **Focus target:** Front wheel.
- **DOF:** Moderate-shallow; the `DDD performance` panel behind is soft. ~f/3.
- **Lighting/reflections:** Strong window wash from the left creates a bright
  vertical gradient on the nose; Michelin sidewall lettering catches a rim of
  light. The most "designed" reflection in the film — a long unbroken highlight
  from nose to sill.
- **Environment:** `DDD performance` panel, concrete column, tall windows,
  screed floor.
- **Transition out:** Hard cut.

### S19 — 13.533 → 14.233 s · 42 f · **Indoor**
- **Visible part:** Cabin through the windscreen/side glass — steering wheel
  with a purple-tinted centre, carbon dash, digital display, red indicator.
- **Camera position:** Outside the glass, slightly above the belt line.
- **Focal length:** ~50–85 mm.
- **Movement:** Slow drift right.
- **Focus target:** Steering wheel.
- **DOF:** Shallow. ~f/2.2.
- **Lighting/reflections:** Heavy veiling reflection across the glass; a
  yellow-green object outside reflects as a soft blob. Interior in deep shadow
  with a few carbon sheens.
- **Environment:** Reflected hall.
- **Transition out:** Hard cut.

### S20 — 14.233 → 14.983 s · 45 f · **Indoor**
- **Visible part:** Front three-quarter low, with the **dihedral door raised**
  (large carbon door panel across the top of frame, `DDD` logo strip on it).
- **Camera position:** Very low, ~0.35 m, close.
- **Focal length:** ~24–35 mm — the widest indoor framing.
- **Movement:** Truck right.
- **Focus target:** Front wheel / sill.
- **DOF:** Moderate. ~f/3.5.
- **Lighting/reflections:** The raised door catches window light on its
  underside and casts the body into partial shade — a deliberate contrast
  between the lit lower body and the shadowed cabin.
- **Environment:** `CARNA` flag, concrete wall, windows, black panels, a person
  bending over a display.
- **Transition out:** Hard cut.

### S21 — 14.983 → 15.650 s · 40 f · Outdoor
- **Visible part:** Rear wing assembly from behind-left — engine cover, wing
  blade, uprights, actuator linkage, rear deck vents.
- **Camera position:** Just below wing height, ~0.8 m out.
- **Focal length:** ~85 mm.
- **Movement:** Slight drift.
- **Focus target:** Wing upright / actuator.
- **DOF:** Shallow; spectators' legs behind are soft. ~f/2.5.
- **Lighting/reflections:** Overcast sky gives the wing blade a clean bright
  upper edge; the purple engine cover shows a long soft sky smear. Final beauty
  beat before the cut to black.
- **Transition out:** Hard cut to black.

### S22 — 15.650 → 16.600 s · 57 f · Outro
- Flat near-black hold (measured mean luma ≈ 6/255, uniform across the frame —
  crushed black, not pure 0). No logo or text detected at boosted exposure.
- **Recreation:** render 57 frames of a flat `RGB ≈ (0.024, 0.024, 0.024)`
  card, or hold black in the compositor.

## 4. Summary table

| # | In (s) | Out (s) | Dur (s) | Frames (0-based) | Loc | Subject | Lens | Move |
|---|---|---|---|---|---|---|---|---|
| 01 | 0.000 | 0.933 | 0.933 | 0–55 | Out | Front 3/4, pillar occluder | ~50 | truck R |
| 02 | 0.933 | 1.667 | 0.733 | 56–99 | Out | Whole car hero | ~30 | arc R |
| 03 | 1.667 | 2.367 | 0.700 | 100–141 | Out | Front wheel | ~110 | truck R |
| 04 | 2.367 | 3.000 | 0.633 | 142–179 | Out | Rear 3/4 | ~45 | truck R |
| 05 | 3.000 | 4.483 | **1.483** | 180–268 | Out | Rear haunch/taillight | ~50 | truck R |
| 06 | 4.483 | 5.167 | 0.683 | 269–309 | **In** | Whole car | ~35 | truck R |
| 07 | 5.167 | 5.867 | 0.700 | 310–351 | Out | Rear wing macro | ~135 | drift |
| 08 | 5.867 | 6.533 | 0.667 | 352–391 | Out | Akrapovič / JESKO | ~135 | drift |
| 09 | 6.533 | 7.267 | 0.733 | 392–435 | **In** | Front wheel + caliper | ~100 | truck L |
| 10 | 7.267 | 7.967 | 0.700 | 436–477 | **In** | Bonnet + ghost badge | ~135 | drift L |
| 11 | 7.967 | 8.717 | 0.750 | 478–522 | **In** | Shield badge | ~165 | drift |
| 12 | 8.717 | 9.350 | 0.633 | 523–560 | **In** | Interior via glass | ~85 | drift |
| 13 | 9.350 | 10.050 | 0.700 | 561–602 | Out | JESKO script | ~135 | drift R |
| 14 | 10.050 | 10.750 | 0.700 | 603–644 | **In** | Centre-lock nut | ~180 | drift L |
| 15 | 10.750 | 11.483 | 0.733 | 645–688 | Out | Door mirror | ~95 | truck R |
| 16 | 11.483 | 12.200 | 0.717 | 689–731 | Out | Headlight / wing | ~70 | drift |
| 17 | 12.200 | 12.867 | 0.667 | 732–771 | **In** | Whole car front 3/4 | ~45 | truck |
| 18 | 12.867 | 13.533 | 0.667 | 772–811 | **In** | Low front 3/4 close | ~35 | push R |
| 19 | 13.533 | 14.233 | 0.700 | 812–853 | **In** | Interior via glass | ~70 | drift R |
| 20 | 14.233 | 14.983 | 0.750 | 854–898 | **In** | Low 3/4, door raised | ~30 | truck R |
| 21 | 14.983 | 15.650 | 0.667 | 899–938 | Out | Rear wing assembly | ~85 | drift |
| 22 | 15.650 | 16.600 | 0.950 | 939–995 | — | Black hold | — | — |

**Totals:** 22 shots · 996 frames · 16.600 s · all transitions hard cuts.
11 outdoor · 10 indoor · 1 black.

## 5. Material requirements extracted from the reference

| Material | Evidence in reference | Build note |
|---|---|---|
| **Body paint** | S10, S11, S13 — twill visible *through* colour | Candy: tinted transmissive coat over a carbon-twill base, not a solid metallic |
| **Centre stripe** | S01, S02, S06 — tan/champagne, matte-ish | Separate low-gloss material, masked to the stripe |
| **Exposed carbon** | S07, S14, S18, S21 | Fine twill (~4–5 mm cell), low-frequency normal, roughness ~0.25, strong grazing response |
| **Glass** | S12, S19 | Heavy veiling reflection, dark tint, interior barely readable |
| **Tyre** | S09, S18 | Dark rubber, roughness ~0.75, raised sidewall lettering catching a rim |
| **Brake disc** | S03, S09 | Drilled carbon-ceramic, mid-grey, subtle radial anisotropy |
| **Caliper** | S09 | Gold/champagne anodised, warmest element in frame |
| **Centre-lock nut** | S14 | Brushed metal, anisotropic streak |
| **Taillight** | S04, S05 | Saturated red emissive arc, spilling onto adjacent paint |
| **Headlight** | S01, S16 | Cream/white DRL blade + iridescent projector optics |
| **Badges** | S10, S11 | Chrome bezel + chequer, high specular |

## 6. Lighting requirements extracted from the reference

**Outdoor (Location A):** a single very large overcast dome. The whole look is
one enormous soft source overhead with open sky to the horizon. Reflections are
broad, soft and low-contrast — long horizontal smears, no hard specular dots.
Ground is wet tarmac contributing a dim bounce and soft mirror.

**Indoor (Location B):** two distinct systems that must both be present —
1. **Large window wall** (camera-left in most setups) — the dominant soft key,
   blown to white, producing the long clean flank highlights in S06/S18.
2. **Circular ceiling downlights** — small, high-intensity point-ish sources
   producing the crisp round specular dots on the bonnet in S10 and S17. These
   are what make the paint read as expensive; a soft-only rig will not
   reproduce them.
Plus a bright screed floor giving upward bounce into the sills and wheel wells.

## 7. Uncertainties and judgement calls

- **Focal lengths are estimates** derived from framing, subject distance and
  background compression. No EXIF is available. They should be treated as
  starting values to be matched by eye against the reference frames.
- **Door state (S06).** Doors read closed in S06/S17 and clearly open in S20.
  A raised door edge appears in the last frames of S06. Recreated as static per
  shot rather than animated, since no opening motion is visible within any shot.
- **The `SPS` plate and `CARNA` / `DDD performance` branding** are real
  third-party marks. They are recreated as generic display graphics rather than
  reproduced logos.
- **Crowd.** The reference contains dozens of identifiable people, several in
  near-focus (S01, S02, S05). See the implementation plan for how this is
  handled.


## 8. Reconstruction notes

Added after the scene was built, recording decisions the analysis above drove.

**Source model.** A Koenigsegg Jesko 2020 GTA V port (Open3DLab project
`7de202a0-9d61-4005-8f99-919fbf546349`, CC BY-NC-ND 4.0), 274 k triangles,
already at real-world scale: 4.59 m long, 2.74 m wheelbase, 0.69/0.73 m wheels.
It is the Attack variant with the correct rear wing, and carries real texture
detail where the macro shots need it - Michelin sidewall lettering, the
engraved centre-lock nut, the Koenigsegg caliper text, the JESKO flank script
and the shield badge. The original file is kept read-only at
`project/source/koenigsegg_source.blend` and is never written to.

**What the port required.** Every shader was the same stamped graph with a flat
0.5 roughness, and each one fed its GTA spec map into Principled's "Specular
IOR Level" - a dielectric reflectance control, not a gloss map - so every
surface reflected wrongly and identically. Those were rewired to drive
roughness. Shaders with no diffuse texture kept Blender's 0.8 white default,
which is why the wing, splitter and underbody first rendered pale. The model
also carries acid-green, blue and yellow GTA accent trim the reference car does
not have; those are neutralised to dark carbon.

**Where the reconstruction departs from the reference, and why.**

- *Crowd.* The reference contains dozens of identifiable people, several close
  to focus. They are rebuilt as simplified figures with correct height, stance
  spread and clothing value range, which is what survives the depth of field
  that covers them in almost every shot. Modelling recognisable individuals was
  out of scope and would not read differently once defocused.
- *Branding.* The `SPS` plate and the `CARNA` / `DDD performance` display
  graphics are real third-party marks; they are suggested with generic panels
  rather than reproduced.
- *Tyres.* The model's sidewall texture is Michelin, matching the reference.
  Its inner tyre material is a Pirelli map that the camera never sees.
- *Door state.* No reference shot contains a door opening, so the door is posed
  static per shot - closed everywhere except S20, where the reference clearly
  shows it raised.
- *Lens values.* Focal lengths were estimated from framing, subject distance
  and background compression, then corrected against rendered frames. S01 in
  particular had to come down from 50 mm to 40 mm: at 50 mm, a camera distance
  that sizes the car correctly puts the band of spectators entirely outside the
  vertical field, which the reference plainly does not do.
