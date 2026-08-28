"""Camera and film character, applied in the compositor.

A path tracer produces an optically perfect image: no grain, no dispersion, no
falloff, no bloom. Real footage has all four, and their absence is one of the
strongest remaining tells that a frame was rendered rather than shot. None of
this is heavy - it is deliberately at the threshold of noticing.
"""
import bpy


def build(scene, grain=0.016, dispersion=0.0035, vignette=0.22, bloom=True):
    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    rl = nt.nodes.new("CompositorNodeRLayers"); rl.location = (-900, 0)
    out = nt.nodes.new("CompositorNodeComposite"); out.location = (900, 0)
    src = rl.outputs["Image"]

    if bloom:
        # Highlights on wet tarmac and polished screed bloom slightly in a real
        # lens. Fog Glow rather than streaks: this is a lens, not an anamorphic.
        g = nt.nodes.new("CompositorNodeGlare"); g.location = (-680, 0)
        g.glare_type = 'FOG_GLOW'
        g.quality = 'HIGH'
        g.iterations = 3
        g.threshold = 1.0
        g.size = 7
        g.mix = -0.86            # mostly original, a little glow
        nt.links.new(src, g.inputs["Image"])
        src = g.outputs["Image"]

    if dispersion > 0:
        # Lateral chromatic aberration, strongest toward the frame edge.
        ld = nt.nodes.new("CompositorNodeLensdist"); ld.location = (-460, 0)
        ld.use_fit = True
        ld.inputs["Distortion"].default_value = 0.0
        ld.inputs["Dispersion"].default_value = dispersion
        nt.links.new(src, ld.inputs["Image"])
        src = ld.outputs["Image"]

    if vignette > 0:
        ell = nt.nodes.new("CompositorNodeEllipseMask"); ell.location = (-680, -380)
        ell.width = 1.05
        ell.height = 1.05
        blur = nt.nodes.new("CompositorNodeBlur"); blur.location = (-460, -380)
        blur.filter_type = 'GAUSS'
        blur.use_relative = True
        blur.factor_x = 32.0
        blur.factor_y = 32.0
        nt.links.new(ell.outputs["Mask"], blur.inputs["Image"])

        lift = nt.nodes.new("CompositorNodeMapRange"); lift.location = (-260, -380)
        lift.inputs["From Min"].default_value = 0.0
        lift.inputs["From Max"].default_value = 1.0
        lift.inputs["To Min"].default_value = 1.0 - vignette
        lift.inputs["To Max"].default_value = 1.0
        nt.links.new(blur.outputs["Image"], lift.inputs["Value"])

        vm = nt.nodes.new("CompositorNodeMixRGB"); vm.location = (-60, -140)
        vm.blend_type = 'MULTIPLY'
        vm.inputs["Fac"].default_value = 1.0
        nt.links.new(src, vm.inputs[1])
        nt.links.new(lift.outputs["Value"], vm.inputs[2])
        src = vm.outputs["Image"]

    if grain > 0:
        tex = bpy.data.textures.get("FILM_GRAIN")
        if tex is None:
            tex = bpy.data.textures.new("FILM_GRAIN", type='NOISE')
        tn = nt.nodes.new("CompositorNodeTexture"); tn.location = (-460, 380)
        tn.texture = tex

        # Centre the noise on zero so it adds and subtracts rather than only
        # brightening, then scale it right down.
        sub = nt.nodes.new("CompositorNodeMixRGB"); sub.location = (-240, 380)
        sub.blend_type = 'SUBTRACT'
        sub.inputs["Fac"].default_value = 1.0
        sub.inputs[2].default_value = (0.5, 0.5, 0.5, 1.0)
        nt.links.new(tn.outputs["Color"], sub.inputs[1])

        gm = nt.nodes.new("CompositorNodeMixRGB"); gm.location = (200, 0)
        gm.blend_type = 'ADD'
        gm.inputs["Fac"].default_value = grain
        nt.links.new(src, gm.inputs[1])
        nt.links.new(sub.outputs["Image"], gm.inputs[2])
        src = gm.outputs["Image"]

    nt.links.new(src, out.inputs["Image"])
    return nt
