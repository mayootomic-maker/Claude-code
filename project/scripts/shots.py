"""The 22-shot table, derived from project/reference_analysis.md.

Coordinates are world-space metres with the car at the origin, nose toward +Y
and its left flank toward -X (the side the reference shoots from almost
throughout). The tyres rest on Z=0.

Landmarks measured from the model:
    front wheel centre   (-0.83,  1.30, 0.35)      rear wheel centre (-0.855, -1.44, 0.36)
    headlight            (-0.80,  1.69, 0.65)      taillight         (-0.76, -1.90, 0.73)
    nose tip             ( 0.00,  2.31, 0.55)      wing top          ( 0.00, -1.90, 1.23)
    steering wheel       (-0.31,  0.44, 0.72)      door mirror       (-1.08,  0.72, 0.99)

Each shot gives a start and end camera pose; motion is Bezier-eased so nothing
moves at a constant machine rate, and a light noise modifier adds the handheld
float that is present in every reference shot.
"""

FPS = 60

# name, first, last (1-based, inclusive)
RANGES = [
    ("S01", 1, 56), ("S02", 57, 100), ("S03", 101, 142), ("S04", 143, 180),
    ("S05", 181, 269), ("S06", 270, 310), ("S07", 311, 352), ("S08", 353, 392),
    ("S09", 393, 436), ("S10", 437, 478), ("S11", 479, 523), ("S12", 524, 561),
    ("S13", 562, 603), ("S14", 604, 645), ("S15", 646, 689), ("S16", 690, 732),
    ("S17", 733, 772), ("S18", 773, 812), ("S19", 813, 854), ("S20", 855, 899),
    ("S21", 900, 939), ("S22", 940, 996),
]

# loc: "plaza" | "hall" | "black"
# cam_a/cam_b: camera position at first/last frame
# tgt_a/tgt_b: focus + aim point at first/last frame
# lens mm, fstop, handheld amplitude (metres of positional noise)
SHOTS = {
# The opening framing needs both the whole car front and a band of spectators
# above it. At 50 mm and a distance that sizes the car correctly, the crowd
# falls outside the vertical field entirely, so the reference lens must be
# nearer 40 mm than 50.
"S01": dict(loc="plaza", lens=40,  fstop=2.0, shake=0.010,
            cam_a=(-1.20, 5.45, 1.00), cam_b=(-1.92, 5.19, 1.01),
            tgt_a=(-0.10, 1.90, 0.62), tgt_b=(-0.10, 1.90, 0.62),
            note="Front 3/4 low, canopy column wiping the left edge."),

"S02": dict(loc="plaza", lens=30,  fstop=4.0, shake=0.016,
            cam_a=(-7.45, -1.30, 0.50), cam_b=(-5.55, 5.05, 0.57),
            tgt_a=(0.00, -0.20, 0.58), tgt_b=(0.00, 0.70, 0.58),
            note="Whole-car hero; operator walks an arc around the front."),

"S03": dict(loc="plaza", lens=110, fstop=2.5, shake=0.006,
            cam_a=(-2.08, 1.04, 0.35), cam_b=(-2.08, 1.53, 0.35),
            tgt_a=(-0.83, 1.30, 0.35), tgt_b=(-0.83, 1.30, 0.35),
            note="Front wheel macro."),

"S04": dict(loc="plaza", lens=45,  fstop=2.8, shake=0.011,
            cam_a=(-1.78, -5.34, 1.10), cam_b=(-0.82, -5.38, 1.10),
            tgt_a=(-0.60, -1.95, 0.76), tgt_b=(-0.60, -1.95, 0.76),
            note="Rear 3/4 from behind-left."),

"S05": dict(loc="plaza", lens=50,  fstop=2.8, shake=0.009,
            cam_a=(-2.42, -2.80, 0.80), cam_b=(-1.02, -3.28, 0.83),
            tgt_a=(-0.80, -1.88, 0.74), tgt_b=(-0.80, -1.88, 0.74),
            note="Longest shot: sustained truck right across the rear haunch."),

"S06": dict(loc="hall",  lens=35,  fstop=4.0, shake=0.013,
            cam_a=(-6.55, 3.05, 1.20), cam_b=(-4.55, 4.65, 1.23),
            tgt_a=(0.00, 0.30, 0.60), tgt_b=(0.00, 0.55, 0.60),
            note="Hall establishing; stanchion parallax."),

"S07": dict(loc="plaza", lens=135, fstop=2.0, shake=0.004,
            cam_a=(-1.18, -2.78, 1.31), cam_b=(-0.94, -2.82, 1.31),
            tgt_a=(-0.36, -1.96, 1.16), tgt_b=(-0.36, -1.96, 1.16),
            note="Rear wing blade macro."),

"S08": dict(loc="plaza", lens=135, fstop=2.0, shake=0.004,
            cam_a=(-1.58, -3.32, 0.56), cam_b=(-1.44, -3.36, 0.55),
            tgt_a=(-0.46, -2.24, 0.48), tgt_b=(-0.46, -2.24, 0.48),
            note="Rear quarter, exhaust shroud and script."),

"S09": dict(loc="hall",  lens=100, fstop=2.5, shake=0.006,
            cam_a=(-1.96, 1.56, 0.40), cam_b=(-1.96, 1.14, 0.40),
            tgt_a=(-0.83, 1.30, 0.35), tgt_b=(-0.83, 1.30, 0.35),
            note="Front wheel and caliper, indoors."),

"S10": dict(loc="hall",  lens=135, fstop=2.0, shake=0.004,
            cam_a=(-0.72, 2.98, 1.30), cam_b=(-0.94, 2.92, 1.29),
            tgt_a=(-0.26, 1.86, 0.75), tgt_b=(-0.26, 1.86, 0.75),
            note="Bonnet crown: downlight dots and weave through the candy."),

"S11": dict(loc="hall",  lens=165, fstop=1.8, shake=0.003,
            cam_a=(-0.56, 3.06, 0.66), cam_b=(-0.48, 3.08, 0.66),
            tgt_a=(-0.04, 2.28, 0.62), tgt_b=(-0.04, 2.28, 0.62),
            note="Shield badge against a blown window."),

"S12": dict(loc="hall",  lens=85,  fstop=2.0, shake=0.005,
            cam_a=(-2.08, 1.10, 1.16), cam_b=(-2.02, 0.96, 1.15),
            tgt_a=(-0.31, 0.44, 0.72), tgt_b=(-0.31, 0.44, 0.72),
            note="Cabin through the side glass."),

"S13": dict(loc="plaza", lens=135, fstop=2.0, shake=0.004,
            cam_a=(-1.98, -0.58, 0.85), cam_b=(-1.98, -0.16, 0.85),
            tgt_a=(-1.02, -0.36, 0.80), tgt_b=(-1.02, -0.36, 0.80),
            note="JESKO script on the rear quarter."),

"S14": dict(loc="hall",  lens=180, fstop=1.8, shake=0.003,
            cam_a=(-1.46, 1.31, 0.36), cam_b=(-1.46, 1.22, 0.36),
            tgt_a=(-0.86, 1.30, 0.35), tgt_b=(-0.86, 1.30, 0.35),
            note="Centre-lock nut; tightest framing in the film."),

"S15": dict(loc="plaza", lens=95,  fstop=2.0, shake=0.006,
            cam_a=(-1.98, 0.02, 1.02), cam_b=(-1.92, 0.56, 1.02),
            tgt_a=(-1.08, 0.72, 0.99), tgt_b=(-1.08, 0.72, 0.99),
            note="Door mirror backlit against the plaza."),

"S16": dict(loc="plaza", lens=70,  fstop=2.2, shake=0.006,
            cam_a=(-2.18, 2.88, 0.55), cam_b=(-2.10, 2.78, 0.56),
            tgt_a=(-0.80, 1.72, 0.62), tgt_b=(-0.80, 1.72, 0.62),
            note="Front wing and headlight blade."),

"S17": dict(loc="hall",  lens=45,  fstop=3.5, shake=0.011,
            cam_a=(-3.05, 6.60, 1.30), cam_b=(-1.60, 6.92, 1.30),
            tgt_a=(0.00, 0.85, 0.55), tgt_b=(0.00, 0.85, 0.55),
            note="Whole car near head-on; stanchion sweeps the right."),

"S18": dict(loc="hall",  lens=35,  fstop=3.0, shake=0.010,
            cam_a=(-3.10, 3.10, 0.38), cam_b=(-2.58, 3.58, 0.41),
            tgt_a=(-0.78, 1.34, 0.42), tgt_b=(-0.78, 1.34, 0.42),
            note="Low hero: long unbroken window highlight nose to sill."),

"S19": dict(loc="hall",  lens=70,  fstop=2.2, shake=0.005,
            cam_a=(-1.78, 1.88, 1.30), cam_b=(-1.58, 2.02, 1.30),
            tgt_a=(-0.31, 0.50, 0.74), tgt_b=(-0.31, 0.50, 0.74),
            note="Cabin through the windscreen; heavy veiling reflection."),

"S20": dict(loc="hall",  lens=30,  fstop=3.5, shake=0.012, door_open=True,
            cam_a=(-3.38, 2.02, 0.38), cam_b=(-2.78, 2.58, 0.41),
            tgt_a=(-0.85, 0.95, 0.50), tgt_b=(-0.85, 0.95, 0.50),
            note="Low 3/4 with the dihedral door raised."),

"S21": dict(loc="plaza", lens=85,  fstop=2.5, shake=0.005,
            cam_a=(-1.68, -3.48, 1.05), cam_b=(-1.56, -3.42, 1.06),
            tgt_a=(-0.55, -2.05, 1.10), tgt_b=(-0.55, -2.05, 1.10),
            note="Rear wing assembly; final beauty beat."),

"S22": dict(loc="black", lens=50,  fstop=8.0, shake=0.0,
            cam_a=(0.0, 0.0, 40.0), cam_b=(0.0, 0.0, 40.0),
            tgt_a=(0.0, 0.0, 39.0), tgt_b=(0.0, 0.0, 39.0),
            note="Flat near-black outro hold."),
}

FIRST_FRAME = RANGES[0][1]
LAST_FRAME = RANGES[-1][2]


def shot_for_frame(f):
    for name, a, b in RANGES:
        if a <= f <= b:
            return name
    return None


def ranges_by_loc(loc):
    return [(n, a, b) for n, a, b in RANGES if SHOTS[n]["loc"] == loc]
