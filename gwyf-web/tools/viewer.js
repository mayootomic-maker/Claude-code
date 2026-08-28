/* Grid turntable used to eyeball every model at once. Dev only -- not bundled. */
window.GWViewer = function (library, names, opts) {
  const o = Object.assign({ cols: 4, cell: 300, pitch: 12, yaw: 0, fit: 0.78 }, opts || {});
  const rows = Math.ceil(names.length / o.cols);
  const W = o.cols * o.cell, H = rows * o.cell;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const env = GWEnv.build(renderer, opts && opts.env || 'velvet');
  const scene = new THREE.Scene();
  scene.environment = env;

  const key = new THREE.DirectionalLight(0xfff0dd, 1.5);
  key.position.set(-4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.06));

  const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 100);

  names.forEach((name, i) => {
    const col = i % o.cols, row = Math.floor(i / o.cols);
    const obj = GWModels.instance(library, name);

    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    obj.position.sub(centre);

    const holder = new THREE.Group();
    holder.add(obj);
    holder.rotation.y = THREE.MathUtils.degToRad(o.yaw);
    holder.rotation.x = THREE.MathUtils.degToRad(o.pitch);
    scene.add(holder);

    // Bounding sphere, not half the largest edge: a cube viewed from a corner
    // projects wider than its edge and gets clipped.
    const radius = size.length() * 0.5 || 0.5;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(28 / 2)) / o.fit;

    renderer.setViewport(col * o.cell, H - (row + 1) * o.cell, o.cell, o.cell);
    renderer.setScissor(col * o.cell, H - (row + 1) * o.cell, o.cell, o.cell);
    renderer.setScissorTest(true);
    cam.position.set(0, 0, dist);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    scene.remove(holder);
    window.__labels = window.__labels || [];
    window.__labels.push({ name, col, row, tris: countTris(obj), size: size.toArray().map(n => +n.toFixed(2)) });
  });

  function countTris(obj) {
    let n = 0;
    obj.traverse((m) => { if (m.isMesh) n += m.geometry.index.count / 3; });
    return n;
  }
  return canvas;
};
