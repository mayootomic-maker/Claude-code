"""Rebuild the car's materials.

The source is a GTA V port: every shader is the same stamped graph
(DiffuseSampler -> Base Color, BumpSampler -> Normal, SpecSampler -> Specular
IOR Level) with a flat 0.5 roughness, and the paint is an opaque node group.
That reads as a game asset under close inspection, so the paint and glass are
rebuilt from scratch and every other shader is re-tuned.

Two fixes matter most:
  * SpecSampler was wired into "Specular IOR Level", which is a 0..1 dielectric
    reflectance control, not a gloss map. Feeding a GTA spec map into it makes
    every surface reflect wrongly and uniformly. It is rewired to drive
    Roughness instead.
  * The body is candy purple over exposed carbon, not solid metallic paint --
    the reference macros (S10, S11, S13) plainly show twill through the colour.
"""
import bpy, math

# Sampled off the reference rather than guessed. Lit body midtones measure
# sRGB (20,15,24)-(56,42,57), i.e. linear ~0.007-0.040 with R about equal to B
# and G well below both: a very dark violet that only shows its colour where
# light strikes square. The first pass at this was far too bright and too pink.
PAINT_TINT = (0.0185, 0.0072, 0.0205)
# Sampled from the bonnet stripe in S01: sRGB (201,195,186) mid, (219,212,208)
# lit -- a satin warm off-white, not gold.
STRIPE_COLOR = (0.255, 0.229, 0.180)
CALIPER_GOLD = (0.520, 0.395, 0.185)
STRIPE_HALF_WIDTH = 0.076              # metres either side of centreline
STRIPE_MIN_Z = 0.10                    # keep it off the lower bodywork

PAINT_MATS = ("vehicle_paint1", "vehicle_paint1.001", "vehicle_paint1.002")
GLASS_MATS = ("vehicle_vehglass", "vehicle_vehglass.001", "vehicle_vehglass_inner")
CARBON_MATS = ("vehicle_mesh.011", "vehicle_mesh.009", "vehicle_mesh.034",
               "vehicle_tire.016", "vehicle_mesh")
TYRE_MATS = ("vehicle_tire.017", "vehicle_tire.013")
# The model carries acid-green, blue and yellow GTA accent trim that the
# reference car simply does not have. They are neutralised to dark carbon.
NEUTRALIZE_MATS = ("vehicle_mesh.023", "vehicle_mesh.022", "vehicle_mesh.029")
HUB_OBJECTS = ("hub_lf", "hub_rf", "hub_lr", "hub_rr")
DISC_MATS = ("vehicle_tire.015",)
WHEEL_MATS = ("vehicle_tire.014",)
TAILLIGHT_MATS = ("vehicle_lightsemissive.004", "vehicle_lightsemissive.002")
HEADLIGHT_MATS = ("vehicle_lightsemissive.001", "vehicle_lightsemissive.003")
DIM_EMISSIVE_MATS = ("vehicle_lightsemissive", "vehicle_lightsemissive.005",
                     "vehicle_lightsemissive.006", "vehicle_dash_emissive",
                     "vehicle_dash_emissive.001", "vehicle_dash_emissive_opaque",
                     "vehicle_dash_emissive_opaque.001")


# ---------------------------------------------------------------- carbon weave

def carbon_weave_group():
    """A 2x2 twill node group: two crossed strand families alternating over and
    under. Returns colour, roughness break-up and a bump height.

    Scale is in weave cells per metre -- the reference reads about 4-5 mm per
    cell, so the default 220 keeps macro shots honest without turning into the
    giant checkerboard the brief warns against.
    """
    name = "KSEG_CarbonWeave"
    if name in bpy.data.node_groups:
        return bpy.data.node_groups[name]
    g = bpy.data.node_groups.new(name, "ShaderNodeTree")
    g.interface.new_socket("Vector", in_out='INPUT', socket_type='NodeSocketVector')
    s = g.interface.new_socket("Scale", in_out='INPUT', socket_type='NodeSocketFloat')
    s.default_value = 220.0
    g.interface.new_socket("Fac", in_out='OUTPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket("Height", in_out='OUTPUT', socket_type='NodeSocketFloat')

    gin = g.nodes.new("NodeGroupInput"); gin.location = (-900, 0)
    gout = g.nodes.new("NodeGroupOutput"); gout.location = (600, 0)

    # Two wave textures at +/-45 degrees are the two strand directions.
    strands = []
    for i, rot in enumerate((math.radians(45), math.radians(-45))):
        m = g.nodes.new("ShaderNodeMapping")
        m.location = (-700, 250 - i * 400)
        m.inputs["Rotation"].default_value = (0, 0, rot)
        g.links.new(gin.outputs["Vector"], m.inputs["Vector"])
        w = g.nodes.new("ShaderNodeTexWave")
        w.location = (-500, 250 - i * 400)
        w.wave_type = 'BANDS'
        w.bands_direction = 'X'
        w.wave_profile = 'SIN'
        g.links.new(m.outputs["Vector"], w.inputs["Vector"])
        g.links.new(gin.outputs["Scale"], w.inputs["Scale"])
        strands.append(w)

    # A checker at half the strand frequency decides which family is on top.
    cm = g.nodes.new("ShaderNodeMapping"); cm.location = (-700, -150)
    cm.inputs["Rotation"].default_value = (0, 0, math.radians(45))
    g.links.new(gin.outputs["Vector"], cm.inputs["Vector"])
    chk = g.nodes.new("ShaderNodeTexChecker"); chk.location = (-500, -150)
    g.links.new(cm.outputs["Vector"], chk.inputs["Vector"])
    half = g.nodes.new("ShaderNodeMath"); half.location = (-680, -320)
    half.operation = 'DIVIDE'; half.inputs[1].default_value = 2.0
    g.links.new(gin.outputs["Scale"], half.inputs[0])
    g.links.new(half.outputs[0], chk.inputs["Scale"])

    mix = g.nodes.new("ShaderNodeMix"); mix.location = (-250, 0)
    mix.data_type = 'FLOAT'
    g.links.new(chk.outputs["Fac"], mix.inputs["Factor"])
    g.links.new(strands[0].outputs["Fac"], mix.inputs["A"])
    g.links.new(strands[1].outputs["Fac"], mix.inputs["B"])

    # Tighten the contrast so the strands read as strands, not a soft ripple.
    ramp = g.nodes.new("ShaderNodeValToRGB"); ramp.location = (-60, 0)
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[1].position = 0.80
    g.links.new(mix.outputs["Result"], ramp.inputs["Fac"])

    g.links.new(ramp.outputs["Color"], gout.inputs["Fac"])
    g.links.new(mix.outputs["Result"], gout.inputs["Height"])
    return g


# ------------------------------------------------------------------ car paint

def build_paint(mat, with_stripe=True):
    """Candy violet over exposed carbon, under a thick clearcoat."""
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (900, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (560, 0)
    bsdf.name = "Principled BSDF"
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # Object coordinates so the weave and the stripe stay locked to the body
    # no matter how the car is parented or moved.
    texco = nt.nodes.new("ShaderNodeTexCoord"); texco.location = (-1100, 0)
    weave = nt.nodes.new("ShaderNodeGroup"); weave.location = (-880, 0)
    weave.node_tree = carbon_weave_group()
    weave.inputs["Scale"].default_value = 220.0
    nt.links.new(texco.outputs["Object"], weave.inputs["Vector"])

    # The weave modulates the candy colour's brightness rather than sitting
    # beside it, which is what keeps twill readable *through* the coat in the
    # macro shots. Mixing toward a separate carbon colour instead just washed
    # the weave out entirely.
    wr = nt.nodes.new("ShaderNodeMapRange"); wr.location = (-640, 120)
    wr.clamp = True
    wr.inputs["To Min"].default_value = 0.52
    wr.inputs["To Max"].default_value = 1.0
    nt.links.new(weave.outputs["Fac"], wr.inputs["Value"])

    tint = nt.nodes.new("ShaderNodeMixRGB"); tint.location = (-400, 120)
    tint.blend_type = 'MULTIPLY'
    tint.inputs["Fac"].default_value = 1.0
    tint.inputs["Color2"].default_value = (*PAINT_TINT, 1)
    nt.links.new(wr.outputs["Result"], tint.inputs["Color1"])

    base_out = tint.outputs["Color"]
    rough_val = 0.165
    rough_socket = None

    if with_stripe:
        # The reference's tan centre stripe: a band about the centreline,
        # limited to the upper bodywork so it does not run down the splitter.
        sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-880, -330)
        nt.links.new(texco.outputs["Object"], sep.inputs["Vector"])
        absx = nt.nodes.new("ShaderNodeMath"); absx.location = (-700, -280)
        absx.operation = 'ABSOLUTE'
        nt.links.new(sep.outputs["X"], absx.inputs[0])
        # Soft-edged band about the centreline: a sprayed stripe, not a decal.
        band = nt.nodes.new("ShaderNodeMapRange"); band.location = (-540, -280)
        band.clamp = True
        band.inputs["From Min"].default_value = STRIPE_HALF_WIDTH + 0.010
        band.inputs["From Max"].default_value = STRIPE_HALF_WIDTH - 0.010
        nt.links.new(absx.outputs[0], band.inputs["Value"])
        upper = nt.nodes.new("ShaderNodeMapRange"); upper.location = (-540, -450)
        upper.clamp = True
        upper.inputs["From Min"].default_value = STRIPE_MIN_Z - 0.02
        upper.inputs["From Max"].default_value = STRIPE_MIN_Z + 0.02
        nt.links.new(sep.outputs["Z"], upper.inputs["Value"])
        blur = nt.nodes.new("ShaderNodeMath"); blur.location = (-330, -350)
        blur.operation = 'MULTIPLY'
        nt.links.new(band.outputs["Result"], blur.inputs[0])
        nt.links.new(upper.outputs["Result"], blur.inputs[1])

        smix = nt.nodes.new("ShaderNodeMixRGB"); smix.location = (-60, 60)
        smix.blend_type = 'MIX'
        smix.inputs["Color2"].default_value = (*STRIPE_COLOR, 1)
        nt.links.new(blur.outputs[0], smix.inputs["Fac"])
        nt.links.new(tint.outputs["Color"], smix.inputs["Color1"])
        base_out = smix.outputs["Color"]

        # The stripe is a satin finish, the body is not.
        rmix = nt.nodes.new("ShaderNodeMix"); rmix.location = (-60, -150)
        rmix.data_type = 'FLOAT'
        rmix.inputs["A"].default_value = rough_val
        rmix.inputs["B"].default_value = 0.34
        nt.links.new(blur.outputs[0], rmix.inputs["Factor"])
        rough_socket = rmix.outputs["Result"]

    nt.links.new(base_out, bsdf.inputs["Base Color"])
    if rough_socket:
        nt.links.new(rough_socket, bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough_val

    if with_stripe:
        mmix = nt.nodes.new("ShaderNodeMix"); mmix.location = (320, -220)
        mmix.data_type = 'FLOAT'
        mmix.inputs["A"].default_value = 0.45
        mmix.inputs["B"].default_value = 0.0
        nt.links.new(blur.outputs[0], mmix.inputs["Factor"])
        nt.links.new(mmix.outputs["Result"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = 0.45
    bsdf.inputs["IOR"].default_value = 1.47
    bsdf.inputs["Coat Weight"].default_value = 0.88
    bsdf.inputs["Coat Roughness"].default_value = 0.032
    bsdf.inputs["Coat IOR"].default_value = 1.52
    if "Coat Tint" in bsdf.inputs:
        if with_stripe:
            # The candy coat tints everything under it, which turned the cream
            # stripe pink. Neutralise the tint over the stripe only.
            ct = nt.nodes.new("ShaderNodeMixRGB"); ct.location = (320, 240)
            ct.blend_type = 'MIX'
            ct.inputs["Color1"].default_value = (0.50, 0.26, 0.56, 1)
            ct.inputs["Color2"].default_value = (1.0, 1.0, 1.0, 1)
            nt.links.new(blur.outputs[0], ct.inputs["Fac"])
            nt.links.new(ct.outputs["Color"], bsdf.inputs["Coat Tint"])
        else:
            bsdf.inputs["Coat Tint"].default_value = (0.50, 0.26, 0.56, 1)

    # Very faint orange peel. Real clearcoat is never optically flat, and its
    # absence is a large part of why CG paint reads as plastic.
    peel_tex = nt.nodes.new("ShaderNodeTexNoise"); peel_tex.location = (60, -400)
    peel_tex.inputs["Scale"].default_value = 90.0
    peel_tex.inputs["Detail"].default_value = 2.0
    nt.links.new(texco.outputs["Object"], peel_tex.inputs["Vector"])
    peel = nt.nodes.new("ShaderNodeBump"); peel.location = (320, -400)
    peel.inputs["Strength"].default_value = 0.045
    peel.inputs["Distance"].default_value = 0.0015
    nt.links.new(peel_tex.outputs["Fac"], peel.inputs["Height"])
    nt.links.new(peel.outputs["Normal"], bsdf.inputs["Coat Normal"])

    mat.blend_method = 'OPAQUE'
    return mat


# ---------------------------------------------------------------------- glass

def build_glass(mat, tint=(0.105, 0.105, 0.120), roughness=0.035, inner=False):
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (400, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (60, 0)
    b.name = "Principled BSDF"
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    b.inputs["Base Color"].default_value = (*tint, 1)
    b.inputs["Roughness"].default_value = roughness
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["IOR"].default_value = 1.52
    b.inputs["Transmission Weight"].default_value = 1.0
    mat.blend_method = 'BLEND'
    mat.use_backface_culling = False
    if inner:
        b.inputs["Roughness"].default_value = 0.10
        b.inputs["Base Color"].default_value = (0.055, 0.055, 0.065, 1)
    return mat


# ------------------------------------------------- re-tune an imported shader

def _nodes(mat):
    nt = mat.node_tree
    return (nt,
            nt.nodes.get("Principled BSDF"),
            nt.nodes.get("DiffuseSampler"),
            nt.nodes.get("SpecSampler"),
            nt.nodes.get("Normal Map"))


def spec_to_roughness(mat, lo, hi):
    """GTA spec maps were wired into Specular IOR Level, which is wrong.
    Rewire: roughness = remap(1 - spec) into a sane band for this surface."""
    nt, b, _, spec, _ = _nodes(mat)
    if not b:
        return
    for l in list(nt.links):
        if l.to_socket is b.inputs.get("Specular IOR Level"):
            nt.links.remove(l)
    b.inputs["Specular IOR Level"].default_value = 0.5
    if not spec:
        b.inputs["Roughness"].default_value = (lo + hi) * 0.5
        return
    inv = nt.nodes.new("ShaderNodeInvert"); inv.location = (-300, -350)
    nt.links.new(spec.outputs["Color"], inv.inputs["Color"])
    mr = nt.nodes.new("ShaderNodeMapRange"); mr.location = (-120, -350)
    mr.inputs["To Min"].default_value = lo
    mr.inputs["To Max"].default_value = hi
    nt.links.new(inv.outputs["Color"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], b.inputs["Roughness"])


def opaque(mat):
    """Drop the alpha link on surfaces that are not actually cut out. HASHED
    blending costs samples and adds noise for nothing."""
    nt, b, _, _, _ = _nodes(mat)
    if not b:
        return
    for l in list(nt.links):
        if l.to_socket is b.inputs.get("Alpha"):
            nt.links.remove(l)
    b.inputs["Alpha"].default_value = 1.0
    mat.blend_method = 'OPAQUE'


def normal_strength(mat, s):
    nt, _, _, _, nm = _nodes(mat)
    if nm:
        nm.inputs["Strength"].default_value = s


def set_bsdf(mat, **kw):
    _, b, _, _, _ = _nodes(mat)
    if not b:
        return
    for k, v in kw.items():
        k = k.replace("_", " ").title().replace("Ior", "IOR")
        if k in b.inputs:
            b.inputs[k].default_value = v


def hue_shift_diffuse(mat, hue, sat, val):
    """Recolour a texture in place, keeping its printed detail. Used to turn
    the model's acid-green caliper into the reference's champagne gold without
    losing the Koenigsegg lettering on it."""
    nt, b, diff, _, _ = _nodes(mat)
    if not (b and diff):
        return
    hsv = nt.nodes.new("ShaderNodeHueSaturation"); hsv.location = (-260, 200)
    hsv.inputs["Hue"].default_value = hue
    hsv.inputs["Saturation"].default_value = sat
    hsv.inputs["Value"].default_value = val
    nt.links.new(diff.outputs["Color"], hsv.inputs["Color"])
    nt.links.new(hsv.outputs["Color"], b.inputs["Base Color"])


def emissive(mat, strength, color=None):
    nt, b, diff, _, _ = _nodes(mat)
    if not b:
        return
    b.inputs["Emission Strength"].default_value = strength
    if color:
        for l in list(nt.links):
            if l.to_socket is b.inputs.get("Emission Color"):
                nt.links.remove(l)
        b.inputs["Emission Color"].default_value = (*color, 1)
    elif diff and not any(l.to_socket is b.inputs.get("Emission Color")
                          for l in nt.links):
        nt.links.new(diff.outputs["Color"], b.inputs["Emission Color"])


def build_caliper():
    """The caliper is painted with one of the shared body-paint materials, so
    it cannot be recoloured without turning the bodywork gold too. A dedicated
    material is built and swapped into the paint slots of the hub objects only."""
    name = "KSEG_Caliper"
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (400, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled"); b.location = (60, 0)
    b.name = "Principled BSDF"
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    b.inputs["Base Color"].default_value = (*CALIPER_GOLD, 1)
    b.inputs["Metallic"].default_value = 0.90
    b.inputs["Roughness"].default_value = 0.30
    m.blend_method = 'OPAQUE'
    return m


def swap_caliper_slots():
    """Point every body-paint slot on the hub objects at the caliper material."""
    cal = build_caliper()
    n = 0
    for name in HUB_OBJECTS:
        ob = bpy.data.objects.get(name)
        if not ob:
            continue
        for slot in ob.material_slots:
            if slot.material and slot.material.name in PAINT_MATS:
                slot.link = 'OBJECT'
                slot.material = cal
                n += 1
    return n


# ------------------------------------------------------------------ entry point

def apply_all(verbose=True):
    done = []

    for n in PAINT_MATS:
        m = bpy.data.materials.get(n)
        if m:
            build_paint(m, with_stripe=True)
            done.append(("paint", n))

    for n in GLASS_MATS:
        m = bpy.data.materials.get(n)
        if m:
            build_glass(m, inner=n.endswith("inner"))
            done.append(("glass", n))

    for n in CARBON_MATS:
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            spec_to_roughness(m, 0.16, 0.34)
            set_bsdf(m, metallic=0.0, coat_weight=0.62, coat_roughness=0.06,
                     ior=1.46)
            normal_strength(m, 1.3)
            done.append(("carbon", n))

    for n in TYRE_MATS:
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            spec_to_roughness(m, 0.68, 0.88)
            set_bsdf(m, metallic=0.0, coat_weight=0.0, ior=1.5)
            _, b, diff, _, _ = _nodes(m)
            if b and not diff:
                b.inputs["Base Color"].default_value = (0.016, 0.016, 0.017, 1)
            normal_strength(m, 1.6)
            done.append(("tyre", n))

    for n in NEUTRALIZE_MATS:
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            nt, b, diff, _, _ = _nodes(m)
            if b:
                for l in list(nt.links):
                    if l.to_socket is b.inputs.get("Base Color"):
                        nt.links.remove(l)
                b.inputs["Base Color"].default_value = (0.016, 0.016, 0.018, 1)
            spec_to_roughness(m, 0.26, 0.44)
            set_bsdf(m, metallic=0.0, coat_weight=0.2, coat_roughness=0.08)
            done.append(("neutralised", n))

    done.append(("caliper", build_caliper().name))

    for n in DISC_MATS:
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            # The source texture is warm; carbon-ceramic reads neutral grey.
            hue_shift_diffuse(m, 0.5, 0.12, 0.85)
            spec_to_roughness(m, 0.30, 0.48)
            set_bsdf(m, metallic=0.55)
            normal_strength(m, 1.2)
            done.append(("disc", n))

    for n in WHEEL_MATS:
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            spec_to_roughness(m, 0.18, 0.36)
            set_bsdf(m, metallic=0.0, coat_weight=0.5, coat_roughness=0.07)
            normal_strength(m, 1.25)
            done.append(("wheel", n))

    for n in TAILLIGHT_MATS:
        m = bpy.data.materials.get(n)
        if m:
            spec_to_roughness(m, 0.04, 0.12)
            set_bsdf(m, metallic=0.0)
            emissive(m, 2.6, color=(0.62, 0.006, 0.010))
            done.append(("taillight", n))

    for n in HEADLIGHT_MATS:
        m = bpy.data.materials.get(n)
        if m:
            spec_to_roughness(m, 0.03, 0.10)
            set_bsdf(m, metallic=0.0)
            emissive(m, 7.0, color=(0.92, 0.90, 0.78))
            done.append(("headlight", n))

    # Side markers, indicators and reversing lamps are OFF on a parked car.
    # Leaving them emissive put blue and orange glows on the sills that the
    # reference does not have.
    for n in ("vehicle_lightsemissive", "vehicle_lightsemissive.005",
              "vehicle_lightsemissive.006"):
        m = bpy.data.materials.get(n)
        if m:
            emissive(m, 0.0)
            spec_to_roughness(m, 0.10, 0.30)
            set_bsdf(m, metallic=0.0)
            done.append(("lamp_off", n))

    # The dash display is lit in S19, but only just.
    for n in ("vehicle_dash_emissive", "vehicle_dash_emissive.001",
              "vehicle_dash_emissive_opaque", "vehicle_dash_emissive_opaque.001"):
        m = bpy.data.materials.get(n)
        if m:
            emissive(m, 1.1)
            done.append(("dash", n))

    # The cabin reads almost black in every reference interior shot; the
    # imported trim textures are far too light for that.
    for n in ("vehicle_mesh.012", "vehicle_mesh.019", "vehicle_mesh.014",
              "vehicle_mesh.006", "vehicle_mesh.017", "vehicle_mesh.002"):
        m = bpy.data.materials.get(n)
        if m:
            opaque(m)
            hue_shift_diffuse(m, 0.5, 0.35, 0.22)
            spec_to_roughness(m, 0.34, 0.62)
            set_bsdf(m, metallic=0.0, coat_weight=0.0)
            done.append(("interior", n))

    # Everything else: still a game shader with flat 0.5 roughness and a
    # mis-wired spec map. Give it a plausible dielectric response.
    handled = {n for _, n in done}
    for m in bpy.data.materials:
        if not m.use_nodes or m.name in handled:
            continue
        if not m.name.startswith(("vehicle_", "metal", "mirror")):
            continue
        nt, b, _, _, _ = _nodes(m)
        if not b:
            continue
        if m.name.startswith("vehicle_badges"):
            spec_to_roughness(m, 0.10, 0.30)
            set_bsdf(m, metallic=0.55, coat_weight=0.35, coat_roughness=0.05)
            normal_strength(m, 1.2)
        elif m.name in ("metal", "mirror"):
            # Wipers, vents and trim: dark satin metal, not bright chrome.
            spec_to_roughness(m, 0.16, 0.34)
            set_bsdf(m, metallic=0.92, base_color=(0.14, 0.14, 0.15, 1))
        else:
            spec_to_roughness(m, 0.24, 0.52)
            set_bsdf(m, metallic=0.0, coat_weight=0.18, coat_roughness=0.08)
            normal_strength(m, 1.15)
        # Shaders with no diffuse texture kept Blender's 0.8 white default,
        # which is why the wing, splitter and underbody rendered pale. On a car
        # every untextured surface is some kind of dark trim.
        if not _nodes(m)[2] and not m.name.startswith("vehicle_paint"):
            set_bsdf(m, base_color=(0.021, 0.021, 0.023, 1))
        done.append(("generic", m.name))

    swapped = swap_caliper_slots()

    if verbose:
        print("CALIPER_SLOTS_SWAPPED", swapped)
        from collections import Counter
        print("MATERIALS_REBUILT", dict(Counter(k for k, _ in done)))
    return done
