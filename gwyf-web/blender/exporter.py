"""Pack Blender objects into one binary blob the browser can turn into
THREE.BufferGeometry directly.

Why not glTF: GLTFLoader lives in three's examples and ships only as an ES
module, which a single self-contained HTML file cannot import without a bundler
or a blob URL that a strict CSP will refuse. The geometry these models need is
positions, normals and indices -- about forty lines to decode -- so exporting it
directly costs less than carrying a loader that can read the other ninety
percent of glTF we never use.

Positions are quantised to Int16 across each mesh's own bounding box and
normals to Int8. At the sizes these objects appear on screen the error is far
below a pixel, and it makes the blob a third the size of raw Float32.
"""

import base64
import json
import math
import os
import struct

import bpy
import bmesh
import mathutils

from lib import ASSETS


class Packer:
    def __init__(self):
        self.buf = bytearray()
        self.meshes = {}
        self.materials = {}
        # Facts about a model the game also needs -- the roulette pocket order,
        # for one. Deriving it twice is how a wheel ends up paying out on the
        # number next to the one the ball is sitting in.
        self.meta = {}

    # --- buffer ---
    def _put(self, data, align=4):
        while len(self.buf) % align:
            self.buf.append(0)
        off = len(self.buf)
        self.buf.extend(data)
        return [off, len(data)]

    # --- materials ---
    def _material(self, mat):
        if mat is None:
            name = "__default"
            if name not in self.materials:
                self.materials[name] = {"color": [0.8, 0.8, 0.8], "metalness": 0.0,
                                        "roughness": 0.5, "emissive": [0, 0, 0],
                                        "emissiveIntensity": 0.0, "clearcoat": 0.0,
                                        "transmission": 0.0, "ior": 1.5, "opacity": 1.0}
            return name
        name = mat.name
        if name in self.materials:
            return name
        rec = {"color": [0.8, 0.8, 0.8], "metalness": 0.0, "roughness": 0.5,
               "emissive": [0, 0, 0], "emissiveIntensity": 0.0, "clearcoat": 0.0,
               "transmission": 0.0, "ior": 1.5, "opacity": 1.0}
        node = None
        if mat.use_nodes:
            for n in mat.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    node = n
                    break
        if node:
            def get(names, default):
                for n_ in names:
                    if n_ in node.inputs:
                        v = node.inputs[n_].default_value
                        try:
                            return list(v)[:3] if len(v) >= 3 else float(v)
                        except TypeError:
                            return float(v)
                return default
            rec["color"] = get(["Base Color"], [0.8, 0.8, 0.8])
            rec["metalness"] = get(["Metallic"], 0.0)
            rec["roughness"] = get(["Roughness"], 0.5)
            rec["clearcoat"] = get(["Coat Weight", "Clearcoat"], 0.0)
            rec["transmission"] = get(["Transmission Weight", "Transmission"], 0.0)
            rec["ior"] = get(["IOR"], 1.5)
            emis = get(["Emission Color", "Emission"], [0, 0, 0])
            strength = get(["Emission Strength"], 0.0)
            rec["emissive"] = emis
            rec["emissiveIntensity"] = strength
        self.materials[name] = rec
        return name

    # --- geometry ---
    def add(self, name, objects, apply_transform=True):
        """Flatten `objects` (with modifiers evaluated) into one named mesh,
        split into one part per material."""
        depsgraph = bpy.context.evaluated_depsgraph_get()
        # material name -> (verts dict, positions, normals, indices)
        parts = {}
        lo = [math.inf] * 3
        hi = [-math.inf] * 3
        raw = []

        for obj in objects:
            if obj.type == "FONT" or obj.type == "CURVE":
                ev = obj.evaluated_get(depsgraph)
                me = ev.to_mesh()
            elif obj.type != "MESH":
                continue
            else:
                ev = obj.evaluated_get(depsgraph)
                me = ev.to_mesh()
            if me is None:
                continue
            mw = obj.matrix_world if apply_transform else mathutils.Matrix.Identity(4)
            nm = mw.to_3x3().inverted().transposed()

            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            bm.to_mesh(me)
            bm.free()
            me.calc_loop_triangles()
            normals = _corner_normals(me)

            slots = [s.material for s in obj.material_slots] or [None]
            for tri in me.loop_triangles:
                mat = slots[min(tri.material_index, len(slots) - 1)]
                key = self._material(mat)
                tri_out = []
                for li, vi in zip(tri.loops, tri.vertices):
                    co = mw @ me.vertices[vi].co
                    n = (nm @ normals[li]).normalized()
                    for a in range(3):
                        lo[a] = min(lo[a], co[a])
                        hi[a] = max(hi[a], co[a])
                    tri_out.append((tuple(co), tuple(n)))
                raw.append((key, tri_out))
            ev.to_mesh_clear()

        if not raw:
            raise ValueError(f"{name}: nothing to export")

        span = [max(hi[a] - lo[a], 1e-6) for a in range(3)]
        for key, tri in raw:
            part = parts.setdefault(key, {"map": {}, "pos": [], "nrm": [], "idx": []})
            for co, n in tri:
                q = tuple(int(round((co[a] - lo[a]) / span[a] * 65534)) - 32767 for a in range(3))
                qn = tuple(max(-127, min(127, int(round(n[a] * 127)))) for a in range(3))
                vkey = q + qn
                idx = part["map"].get(vkey)
                if idx is None:
                    idx = len(part["map"])
                    part["map"][vkey] = idx
                    part["pos"].extend(q)
                    part["nrm"].extend(qn)
                part["idx"].append(idx)

        out_parts = []
        for key, part in parts.items():
            n = len(part["map"])
            if n > 0xFFFF:
                idx_data = struct.pack(f"<{len(part['idx'])}I", *part["idx"])
                idx_bits = 32
            else:
                idx_data = struct.pack(f"<{len(part['idx'])}H", *part["idx"])
                idx_bits = 16
            out_parts.append({
                "material": key,
                "verts": n,
                "pos": self._put(struct.pack(f"<{len(part['pos'])}h", *part["pos"])),
                "nrm": self._put(bytes((v + 256) % 256 for v in part["nrm"]), align=1),
                "idx": self._put(idx_data),
                "idxBits": idx_bits,
                "tris": len(part["idx"]) // 3,
            })

        self.meshes[name] = {
            "min": [round(v, 5) for v in lo],
            "span": [round(v, 5) for v in span],
            "parts": out_parts,
        }
        return self.meshes[name]

    def write(self, filename="models.json"):
        path = os.path.join(ASSETS, filename)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        doc = {
            "version": 1,
            "materials": {k: _round(v) for k, v in self.materials.items()},
            "meta": self.meta,
            "meshes": self.meshes,
            "buffer": base64.b64encode(bytes(self.buf)).decode("ascii"),
        }
        with open(path, "w") as fh:
            json.dump(doc, fh, separators=(",", ":"))
        return path, len(self.buf)


def _round(rec):
    out = {}
    for k, v in rec.items():
        out[k] = [round(x, 4) for x in v] if isinstance(v, list) else round(v, 4)
    return out


def _corner_normals(me):
    """Per-loop normals across Blender versions.

    calc_normals_split() went away in 4.1 in favour of a read-only
    mesh.corner_normals collection; asking for the attribute first and falling
    back keeps one script working on both.
    """
    if hasattr(me, "corner_normals"):
        try:
            return [mathutils.Vector(c.vector) for c in me.corner_normals]
        except (RuntimeError, AttributeError):
            pass
    try:
        me.calc_normals_split()
    except AttributeError:
        pass
    return [mathutils.Vector(l.normal) for l in me.loops]
