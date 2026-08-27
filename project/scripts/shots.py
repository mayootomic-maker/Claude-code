"""The 22-shot table, derived from project/reference_analysis.md.

Cameras are specified the way a cinematographer picks them, not as raw XYZ:

    tgt   the point the lens is focused on and aimed at (world metres)
    az    bearing FROM the target TO the camera, degrees.
          0 = in front of the car (+Y), 90 = the car's left flank (-X),
          180 = behind (-Y), 270 = the right flank (+X)
    elev  camera elevation above the target, degrees
    fw    how many metres of world the frame spans at the target's distance --
          this is what actually sets how big the subject reads

Camera distance follows from the lens: d = fw * f / sensor_width. Placing
cameras by eye produced macros that sat inside the bodywork and wide shots
that left the car a speck, because a 135 mm lens at 0.9 m frames 0.24 m of
world. Deriving distance from the intended framing fixes that by construction.

The car sits at the origin, nose toward +Y, left flank toward -X, tyres on Z=0.

Landmarks measured from the model:
    front wheel centre   (-0.83,  1.30, 0.35)   rear wheel centre (-0.855, -1.44, 0.36)
    headlight            (-0.80,  1.69, 0.65)   taillight         (-0.80, -1.88, 0.74)
    nose tip             ( 0.00,  2.31, 0.55)   wing top          ( 0.00, -1.90, 1.23)
    steering wheel       (-0.31,  0.44, 0.72)   door mirror       (-1.06,  0.72, 0.98)
"""
import math

FPS = 60
SENSOR = 36.0

RANGES = [
    ("S01", 1, 56), ("S02", 57, 100), ("S03", 101, 142), ("S04", 143, 180),
    ("S05", 181, 269), ("S06", 270, 310), ("S07", 311, 352), ("S08", 353, 392),
    ("S09", 393, 436), ("S10", 437, 478), ("S11", 479, 523), ("S12", 524, 561),
    ("S13", 562, 603), ("S14", 604, 645), ("S15", 646, 689), ("S16", 690, 732),
    ("S17", 733, 772), ("S18", 773, 812), ("S19", 813, 854), ("S20", 855, 899),
    ("S21", 900, 939), ("S22", 940, 996),
]

SHOTS = {
"S01": dict(loc="plaza", lens=40, fstop=2.0, shake=0.010,
            tgt=(-0.10, 1.90, 0.62),
            az_a=17, az_b=28, elev_a=6.0, elev_b=6.2, fw_a=3.35, fw_b=3.35,
            note="Front 3/4 low; canopy column wipes the left edge."),
"S02": dict(loc="plaza", lens=30, fstop=3.5, shake=0.016,
            tgt=(0.00, 0.10, 0.55),
            az_a=58, az_b=26, elev_a=3.0, elev_b=4.0, fw_a=4.80, fw_b=4.55,
            note="Whole-car hero; operator walks an arc around the front."),
"S03": dict(loc="plaza", lens=110, fstop=2.5, shake=0.005,
            tgt=(-0.83, 1.30, 0.35),
            az_a=92, az_b=100, elev_a=0.0, elev_b=0.0, fw_a=1.05, fw_b=1.05,
            note="Front wheel macro."),
"S04": dict(loc="plaza", lens=45, fstop=2.8, shake=0.011,
            tgt=(-0.55, -1.60, 0.70),
            az_a=152, az_b=164, elev_a=2.5, elev_b=2.5, fw_a=2.60, fw_b=2.60,
            note="Rear 3/4 from behind-left."),
"S05": dict(loc="plaza", lens=60, fstop=2.8, shake=0.008,
            tgt=(-0.72, -1.90, 0.76),
            az_a=160, az_b=176, elev_a=2.0, elev_b=2.0, fw_a=1.35, fw_b=1.35,
            note="Longest shot: sustained truck right across the rear haunch. "
                 "Shot from the flank so the wing does not block the taillight."),
"S06": dict(loc="hall", lens=35, fstop=4.0, shake=0.013,
            tgt=(0.00, 0.30, 0.60),
            az_a=56, az_b=33, elev_a=6.5, elev_b=6.5, fw_a=4.20, fw_b=4.20,
            note="Hall establishing; stanchion parallax."),
"S07": dict(loc="plaza", lens=135, fstop=2.2, shake=0.004,
            tgt=(-0.62, -1.92, 1.20),
            az_a=162, az_b=172, elev_a=17.0, elev_b=17.0, fw_a=0.72, fw_b=0.72,
            note="Rear wing blade macro."),
"S08": dict(loc="plaza", lens=135, fstop=2.2, shake=0.004,
            tgt=(-0.30, -2.25, 0.42),
            az_a=168, az_b=176, elev_a=3.0, elev_b=3.0, fw_a=0.62, fw_b=0.62,
            note="Rear quarter: exhaust shroud and script."),
"S09": dict(loc="hall", lens=100, fstop=2.5, shake=0.005,
            tgt=(-0.83, 1.30, 0.35),
            az_a=93, az_b=86, elev_a=0.0, elev_b=0.0, fw_a=1.00, fw_b=1.00,
            note="Front wheel and caliper, indoors."),
"S10": dict(loc="hall", lens=135, fstop=2.2, shake=0.004,
            tgt=(-0.30, 1.90, 0.735),
            az_a=35, az_b=43, elev_a=30.0, elev_b=29.0, fw_a=0.70, fw_b=0.70,
            note="Bonnet crown: downlight dots and weave through the candy."),
"S11": dict(loc="hall", lens=165, fstop=2.8, shake=0.003,
            tgt=(0.00, 2.30, 0.600),
            az_a=5, az_b=11, elev_a=8.0, elev_b=8.0, fw_a=0.40, fw_b=0.40,
            note="Shield badge against a blown window."),
"S12": dict(loc="hall", lens=85, fstop=2.2, shake=0.005,
            tgt=(-0.31, 0.44, 0.72),
            az_a=86, az_b=79, elev_a=12.0, elev_b=12.0, fw_a=1.15, fw_b=1.15,
            note="Cabin through the side glass."),
"S13": dict(loc="plaza", lens=135, fstop=2.2, shake=0.004,
            tgt=(-1.00, -0.15, 0.78),
            az_a=86, az_b=95, elev_a=3.0, elev_b=3.0, fw_a=0.62, fw_b=0.62,
            note="JESKO script on the rear quarter."),
"S14": dict(loc="hall", lens=180, fstop=2.0, shake=0.003,
            tgt=(-0.86, 1.30, 0.35),
            az_a=90, az_b=85, elev_a=0.0, elev_b=0.0, fw_a=0.34, fw_b=0.34,
            note="Centre-lock nut; tightest framing in the film."),
"S15": dict(loc="plaza", lens=95, fstop=2.0, shake=0.006,
            tgt=(-1.06, 0.72, 0.98),
            az_a=104, az_b=94, elev_a=4.0, elev_b=4.0, fw_a=0.85, fw_b=0.85,
            note="Door mirror backlit against the plaza."),
"S16": dict(loc="plaza", lens=70, fstop=2.2, shake=0.006,
            tgt=(-0.80, 1.70, 0.62),
            az_a=42, az_b=37, elev_a=5.0, elev_b=5.0, fw_a=1.05, fw_b=1.05,
            note="Front wing and headlight blade."),
"S17": dict(loc="hall", lens=45, fstop=3.5, shake=0.011,
            tgt=(0.00, 0.85, 0.55),
            az_a=12, az_b=22, elev_a=10.0, elev_b=10.0, fw_a=5.20, fw_b=5.20,
            note="Whole car near head-on; stanchion sweeps the right."),
"S18": dict(loc="hall", lens=35, fstop=3.0, shake=0.010,
            tgt=(-0.75, 1.28, 0.45),
            az_a=46, az_b=37, elev_a=3.5, elev_b=4.0, fw_a=3.10, fw_b=2.95,
            note="Low hero: long unbroken window highlight nose to sill."),
"S19": dict(loc="hall", lens=70, fstop=2.2, shake=0.005,
            tgt=(-0.31, 0.50, 0.74),
            az_a=58, az_b=50, elev_a=11.0, elev_b=11.0, fw_a=1.35, fw_b=1.35,
            note="Cabin through the windscreen; heavy veiling reflection."),
"S20": dict(loc="hall", lens=30, fstop=3.5, shake=0.012, door_open=True,
            tgt=(-0.85, 0.95, 0.50),
            az_a=58, az_b=48, elev_a=3.5, elev_b=4.0, fw_a=3.60, fw_b=3.60,
            note="Low 3/4 with the dihedral door raised."),
"S21": dict(loc="plaza", lens=85, fstop=2.5, shake=0.005,
            tgt=(-0.50, -2.00, 1.05),
            az_a=143, az_b=149, elev_a=6.0, elev_b=6.0, fw_a=1.15, fw_b=1.15,
            note="Rear wing assembly; final beauty beat."),
"S22": dict(loc="black", lens=50, fstop=8.0, shake=0.0,
            tgt=(0.0, 0.0, 39.0),
            az_a=0, az_b=0, elev_a=90, elev_b=90, fw_a=1.0, fw_b=1.0,
            note="Flat near-black outro hold."),
}

FIRST_FRAME = RANGES[0][1]
LAST_FRAME = RANGES[-1][2]


def camera_position(tgt, az_deg, elev_deg, frame_width, lens):
    """Where the camera has to sit to frame `frame_width` metres at `tgt`."""
    d = frame_width * lens / SENSOR
    az = math.radians(az_deg)
    el = math.radians(elev_deg)
    horiz = d * math.cos(el)
    return (tgt[0] - math.sin(az) * horiz,
            tgt[1] + math.cos(az) * horiz,
            tgt[2] + d * math.sin(el)), d


def shot_poses(name):
    """(camera_a, camera_b, distance_a, distance_b) for one shot."""
    s = SHOTS[name]
    a, da = camera_position(s["tgt"], s["az_a"], s["elev_a"], s["fw_a"], s["lens"])
    b, db = camera_position(s["tgt"], s["az_b"], s["elev_b"], s["fw_b"], s["lens"])
    return a, b, da, db


def shot_for_frame(f):
    for name, a, b in RANGES:
        if a <= f <= b:
            return name
    return None


def ranges_by_loc(loc):
    return [(n, a, b) for n, a, b in RANGES if SHOTS[n]["loc"] == loc]
