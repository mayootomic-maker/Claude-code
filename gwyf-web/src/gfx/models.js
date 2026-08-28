/* Decode the Blender export into three.js geometry.

   The blob holds Int16 positions quantised across each mesh's bounding box and
   Int8 normals. Both are widened to Float32 here rather than handed to the GPU
   normalised, because every consumer downstream (bounding spheres, the physics
   hull, the ray picker) wants real units, and 32k triangles of Float32 is a
   rounding error in memory next to a single texture. */

(function (global) {
  'use strict';

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function makeMaterial(rec) {
    const colour = new THREE.Color().setRGB(rec.color[0], rec.color[1], rec.color[2],
                                            THREE.LinearSRGBColorSpace);
    const common = {
      color: colour,
      metalness: rec.metalness,
      roughness: Math.max(rec.roughness, 0.045),
      envMapIntensity: 1.0,
    };

    /* MeshPhysicalMaterial costs a great deal more per fragment than
       MeshStandardMaterial -- it compiles in the clearcoat and transmission
       lobes whether or not they are set, and transmission forces an extra
       full-scene pass. Measured across the twelve tables, making everything
       physical cost about half the frame. So a material is only promoted when
       it genuinely uses those features, and a weak clearcoat is not worth a
       promotion. */
    const wantsCoat = (rec.clearcoat || 0) >= 0.5;
    const wantsGlass = (rec.transmission || 0) > 0.01;

    let m;
    if (wantsCoat || wantsGlass) {
      m = new THREE.MeshPhysicalMaterial(Object.assign({}, common, {
        clearcoat: wantsCoat ? rec.clearcoat : 0,
        clearcoatRoughness: 0.12,
        ior: rec.ior || 1.5,
        transmission: wantsGlass ? rec.transmission : 0,
        // Thin-walled transmission is cheaper and, for a faceted gem read at
        // thumbnail size, indistinguishable from volumetric.
        thickness: wantsGlass ? 0.4 : 0,
      }));
    } else {
      m = new THREE.MeshStandardMaterial(common);
    }

    m.name = rec.name || '';
    if (rec.emissiveIntensity > 0) {
      m.emissive = new THREE.Color().setRGB(rec.emissive[0], rec.emissive[1], rec.emissive[2],
                                            THREE.LinearSRGBColorSpace);
      m.emissiveIntensity = rec.emissiveIntensity;
    }
    return m;
  }

  function decode(doc) {
    const bin = base64ToBytes(doc.buffer);
    const buf = bin.buffer;
    const materials = {};
    for (const key of Object.keys(doc.materials)) {
      const rec = doc.materials[key];
      rec.name = key;
      materials[key] = makeMaterial(rec);
    }

    const meshes = {};
    for (const name of Object.keys(doc.meshes)) {
      const spec = doc.meshes[name];
      const group = new THREE.Group();
      group.name = name;
      for (const part of spec.parts) {
        const qp = new Int16Array(buf, part.pos[0], part.pos[1] / 2);
        const qn = new Int8Array(buf, part.nrm[0], part.nrm[1]);
        const n = part.verts;

        const positions = new Float32Array(n * 3);
        const normals = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          for (let a = 0; a < 3; a++) {
            positions[i * 3 + a] = spec.min[a] + ((qp[i * 3 + a] + 32767) / 65534) * spec.span[a];
            normals[i * 3 + a] = qn[i * 3 + a] / 127;
          }
          // Quantising each component independently leaves the normal slightly
          // off unit length, which shows up as banding on the gold.
          const l = Math.hypot(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]) || 1;
          normals[i * 3] /= l; normals[i * 3 + 1] /= l; normals[i * 3 + 2] /= l;
        }
        const index = part.idxBits === 32
          ? new Uint32Array(buf, part.idx[0], part.idx[1] / 4)
          : new Uint16Array(buf, part.idx[0], part.idx[1] / 2);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geo.setIndex(new THREE.BufferAttribute(index.slice(), 1));
        geo.computeBoundingSphere();

        const mesh = new THREE.Mesh(geo, materials[part.material]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      meshes[name] = group;
    }
    return { meshes, materials, doc };
  }

  /* Models are shared templates. Anything that goes in a scene takes a clone so
     two dice on the same table can hold different transforms. */
  function instance(library, name) {
    const src = library.meshes[name];
    if (!src) throw new Error('unknown model: ' + name);
    const copy = src.clone(true);
    copy.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    return copy;
  }

  global.GWModels = { decode, instance, makeMaterial, base64ToBytes };
})(window);
