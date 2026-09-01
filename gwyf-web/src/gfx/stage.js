/* One renderer, one scene, one animation loop, shared by every game.

   Each game gets a group to fill and a camera rig to aim, and gives back a tick
   function. Building a renderer per game is the obvious alternative and it
   leaks WebGL contexts: browsers cap them at around sixteen, and the sixteenth
   table you walk up to is the one that renders black. */

(function (global) {
  'use strict';

  const CAP_DPR = 2;

  function create(opts) {
    const canvas = opts.canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, CAP_DPR));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = new THREE.Scene();
    /* Fog, set per room.

       It earns its place twice. A casino floor at night should fall away into
       the dark rather than show you every table in the building at full
       brightness, and once the far end of the room is fogged out, machines out
       there can be dropped entirely without anyone seeing them go -- which is
       what makes the distance culling in main.js free rather than a pop. */
    scene.fog = new THREE.Fog(0x120e0d, 12, 40);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    camera.position.set(0, 3.2, 5.2);
    /* Yaw, then pitch, then roll.

       In the default XYZ order the three Euler components are not independent:
       a camera that is both pitched and yawed has a non-zero z component, so
       assigning rotation.z -- as the first-person controller does for the lean
       while strafing -- silently rewrites part of the orientation lookAt just
       computed. Facing along X that rolled the whole view ninety degrees, which
       showed up as the signs on the side walls reading bottom to top. */
    camera.rotation.order = 'YXZ';

    // The game's own objects live in here. Swapping tables empties this group
    // and nothing else, so the lights and environment never flicker.
    const group = new THREE.Group();
    scene.add(group);

    const key = new THREE.DirectionalLight(0xffeedd, 2.7);
    key.position.set(-3.4, 6.0, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -5; key.shadow.camera.right = 5;
    key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
    // A felt is a triangle fan, and a fan self-shadowing under a low bias draws
    // its own triangles across itself as a pinwheel. Pushing the sample along
    // the surface normal instead of just along the light fixes it without the
    // peter-panning a large depth bias causes.
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.06;
    scene.add(key);

    const rim = new THREE.DirectionalLight(0xffb877, 0.9);
    rim.position.set(3.6, 2.4, -4.0);
    scene.add(rim);

    /* A fixed pool of room lights.

       Rooms used to add a light per ceiling panel and a lamp per table, which
       came to twenty-three of them on the busiest floor. three.js compiles
       every light in the scene into every material's shader and evaluates all
       of them for every pixel, so that is the single most expensive thing the
       game was doing -- measured at over half a second a frame on the floor
       with the most lights, with the quality ladder already at half resolution
       and shadows off.

       The pool is a constant size and never changes. That matters as much as
       the count: three.js keys its shader programs on how many lights there
       are, so switching lights on and off as you walk recompiles every material
       in the room mid-stride, which is a far worse stutter than the cost it
       saves. Instead the level hands over a list of places a light should be,
       and each frame the pool is dealt to the nearest of them. Unused slots go
       to zero intensity rather than invisible, for the same reason. */
    const POOL_POINTS = 6;
    const POOL_SPOTS = 2;
    const pool = { points: [], spots: [] };
    for (let i = 0; i < POOL_POINTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 12, 1.7);
      scene.add(l);
      pool.points.push(l);
    }
    for (let i = 0; i < POOL_SPOTS; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, 0.66, 0.5, 1.3);
      scene.add(l, l.target);
      pool.spots.push(l);
    }
    let sites = { points: [], spots: [] };

    /* Deal the pool to the nearest sites. Distance is measured to the camera,
       which in world mode is the player's head. */
    const dealt = [];
    function dealLights() {
      for (const kind of ['points', 'spots']) {
        const list = sites[kind] || [];
        const slots = pool[kind];
        dealt.length = 0;
        for (const site of list) {
          site._d = camera.position.distanceToSquared(site.at);
          dealt.push(site);
        }
        dealt.sort((a, b) => a._d - b._d);
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const site = dealt[i];
          if (!site) { slot.intensity = 0; continue; }
          slot.position.copy(site.at);
          slot.color.set(site.colour);
          slot.intensity = site.intensity;
          slot.distance = site.distance || 12;
          if (site.aim && slot.target) {
            slot.target.position.copy(site.aim);
            slot.target.updateMatrixWorld();
          }
          if (site.angle !== undefined) slot.angle = site.angle;
        }
      }
    }

    /* A small flat term under the hemisphere.

       Six pooled point lights cannot reach the far end of a thirty-metre hall,
       and cutting this to zero to save a light left rooms that were black
       beyond the nearest few lamps. A room has to be visible first and cheap
       second. */
    const ambient = new THREE.AmbientLight(0xffffff, 0.16);

    // Sky-and-ground fill. A single ambient term flattens everything to the
    // same value; a hemisphere keeps the tops of things lighter than their
    // undersides, which is most of what makes a room read as lit at all.
    const sky = new THREE.HemisphereLight(0xffd9a8, 0x241713, 0.62);
    scene.add(sky);

    /* The lamp over the table.

       Every game centres its table on the origin, so one shade hung above the
       origin lights all twelve. It is what makes a casino table read as a
       casino table -- a bright pool with the room falling away around it -- and
       without it the felt came out near black however high the exposure went.
       No shadow: the directional light already casts them, and a second shadow
       map costs more than the light is worth. */
    /* The lamp over the table the player is at. In the world each machine has
       its own shade hung from the ceiling, so this one is switched off while
       walking and switched back on over whichever table is being played. */
    const lamp = new THREE.SpotLight(0xffe0b4, 42, 11, 0.82, 0.62, 1.5);
    lamp.position.set(0.25, 4.3, 0.9);
    lamp.target.position.set(0, 0.1, 0);
    scene.add(lamp, lamp.target);

    const state = {
      running: false, last: 0, ticks: new Set(), env: null, envName: null,
      raf: 0, reduced: false, quality: 1, visible: true, manual: false,
      // Rolling frame cost, and how far quality has already been backed off.
      frameCost: 16, tier: 0, sinceCheck: 0, auto: true,
    };

    /* Step the renderer down when the machine cannot keep up.

       Software rasterisers, integrated laptops and phones all land here, and
       the alternative to noticing is a game that runs at four frames a second
       and looks broken rather than slow. Each tier gives up something that
       costs a lot of fragment work and little of the look, in the order they
       are worth losing. */
    const TIERS = [
      { dpr: 1.00, shadows: true, shadowSize: 1024 },
      { dpr: 0.85, shadows: true, shadowSize: 512 },
      { dpr: 0.70, shadows: false, shadowSize: 512 },
      { dpr: 0.55, shadows: false, shadowSize: 512 },
    ];

    function applyTier() {
      const tier = TIERS[Math.min(state.tier, TIERS.length - 1)];
      renderer.shadowMap.enabled = tier.shadows;
      key.castShadow = tier.shadows;
      if (key.shadow.mapSize.width !== tier.shadowSize) {
        key.shadow.mapSize.set(tier.shadowSize, tier.shadowSize);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
      resize();
    }

    function watchPerformance(dt) {
      if (!state.auto) return;
      // Exponential average: one slow frame while a table is built is not a
      // slow machine, and reacting to it would flicker the resolution.
      state.frameCost += ((dt * 1000) - state.frameCost) * 0.12;
      state.sinceCheck += dt;
      if (state.sinceCheck < 1.6) return;
      state.sinceCheck = 0;
      if (state.frameCost > 34 && state.tier < TIERS.length - 1) {
        // Well past a playable frame time: skip a tier rather than crawl down
        // one every second and a half while the player waits.
        state.tier += state.frameCost > 70 ? 2 : 1;
        state.tier = Math.min(state.tier, TIERS.length - 1);
        applyTier();
      } else if (state.frameCost < 15 && state.tier > 0) {
        state.tier--;
        applyTier();
      }
    }

    const target = new THREE.Vector3(0, 0, 0);
    const desired = { pos: camera.position.clone(), look: target.clone(), ease: 3.2 };

    function setEnvironment(name) {
      if (state.envName === name) return;
      state.envName = name;
      state.env = GWEnv.build(renderer, name);
      scene.environment = state.env;
      const tint = new THREE.Color(GWEnv.ambientTint(name));
      scene.background = tint.clone().multiplyScalar(0.35);
      // Light enough to leave a thirty-metre hall readable end to end. The
      // density that suited a single lit table turned the far wall into a flat
      // wash and made the whole floor one colour.
      scene.fog = new THREE.FogExp2(tint.clone().multiplyScalar(0.28).getHex(), 0.020);
      const accent = { velvet: 0xffeedd, crimson: 0xffd0c4, emerald: 0xe6fff0, void: 0xe8e4ff };
      key.color.setHex(accent[name] || 0xffeedd);
      lamp.color.setHex(accent[name] || 0xffe0b4);
      sky.color.setHex(accent[name] || 0xffd9a8);
    }

    function resize() {
      const w = canvas.clientWidth || canvas.parentElement.clientWidth || 640;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight || 480;
      if (!w || !h) return;
      const tier = TIERS[Math.min(state.tier, TIERS.length - 1)];
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, CAP_DPR) * state.quality * tier.dpr);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function frame(pos, look, ease) {
      desired.pos.set(pos[0], pos[1], pos[2]);
      desired.look.set(look[0], look[1], look[2]);
      desired.ease = ease === undefined ? 3.2 : ease;
    }

    function snap() {
      camera.position.copy(desired.pos);
      target.copy(desired.look);
      camera.lookAt(target);
    }

    function loop(now) {
      state.raf = global.requestAnimationFrame(loop);
      if (!state.visible) return;
      // Two deltas on purpose. Animation and physics get a clamped one, so a
      // stall or a backgrounded tab cannot teleport a die through the table.
      // The performance watcher gets the real one, because clamping it means
      // the worst frame it can ever see is 50ms and a machine running at four
      // frames a second looks, to the detector, merely borderline.
      const raw = (now - state.last) / 1000 || 0;
      // Clamped so a stall cannot teleport a die through the table, but not so
      // tightly that a slow machine plays every animation in slow motion: at
      // 50ms a ten-frame-per-second device ran everything at half speed.
      const dt = Math.min(raw, 0.1);
      state.last = now;

      // Critically damped-ish follow. Snapping the camera between tables reads
      // as a cut; easing it reads as walking up to one. While the player is
      // walking they drive the camera themselves -- easing a first-person view
      // feels like steering a boat.
      if (!state.manual) {
        const k = 1 - Math.exp(-desired.ease * dt);
        camera.position.lerp(desired.pos, k);
        target.lerp(desired.look, k);
        camera.lookAt(target);
      }

      for (const fn of Array.from(state.ticks)) fn(dt, now / 1000);
      dealLights();
      renderer.render(scene, camera);
      watchPerformance(raw);
    }

    function start() {
      if (state.running) return;
      state.running = true;
      state.last = global.performance.now();
      state.raf = global.requestAnimationFrame(loop);
    }

    function stop() {
      state.running = false;
      global.cancelAnimationFrame(state.raf);
    }

    function onTick(fn) {
      state.ticks.add(fn);
      return () => state.ticks.delete(fn);
    }

    /* Empty the game group and free what it held. three does not garbage
       collect GPU memory, so a table left un-disposed is a leak that only shows
       up as a slow crawl after twenty rounds. */
    function clear() {
      const keepMaterials = new Set();
      group.traverse((o) => { if (o.isMesh && o.userData.shared) keepMaterials.add(o.material); });
      for (let i = group.children.length - 1; i >= 0; i--) {
        const child = group.children[i];
        group.remove(child);
        child.traverse((o) => {
          if (!o.isMesh) return;
          if (o.geometry && !o.userData.shared) o.geometry.dispose();
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m || keepMaterials.has(m) || o.userData.shared) continue;
            if (m.map) m.map.dispose();
            m.dispose();
          }
        });
      }
    }

    const ro = global.ResizeObserver ? new global.ResizeObserver(resize) : null;
    if (ro) ro.observe(canvas.parentElement || canvas);
    global.addEventListener('resize', resize);
    global.document.addEventListener('visibilitychange', () => {
      state.visible = !global.document.hidden;
      state.last = global.performance.now();
    });

    resize();

    return {
      renderer, scene, camera, group, key, rim, ambient, sky, lamp, state,
      /* Where a room would like light. See the pool above: the level asks,
         the stage decides how many of the asks it can afford. */
      setLightSites(next) { sites = next || { points: [], spots: [] }; },
      setFog(colour, near, far) {
        scene.fog.color.set(colour);
        scene.fog.near = near;
        scene.fog.far = far;
      },
      get fogFar() { return scene.fog.far; },
      setEnvironment, resize, frame, snap, start, stop, onTick, clear,
      get envName() { return state.envName; },
      /* Pin the renderer where it is. Used by the mod menu's display page and
         by the screenshot harness, which wants a consistent frame rather than a
         fast one. */
      setQuality(q) { state.quality = q; state.auto = false; state.tier = 0; applyTier(); },
      /* Hand the camera to the first-person controller, or take it back. */
      setManualCamera(v) {
        state.manual = !!v;
        // Walking: the floor's own lamps light the room. At a table: the
        // stage lamp adds the pool of light the game was lit for.
        lamp.visible = !state.manual;
      },
      get manualCamera() { return state.manual; },
      get tier() { return state.tier; },
      get frameCost() { return state.frameCost; },
      setReducedMotion(v) { state.reduced = !!v; },
      dispose() {
        stop();
        clear();
        if (ro) ro.disconnect();
        renderer.dispose();
      },
    };
  }

  /* --- shared props ------------------------------------------------------- */

  /* How far a machine's base sits below its playing surface -- which is to say,
     how tall the tables are.

     0.80m, the height of a real casino table. The first pass used 1.05, and
     with a 1.62m eye that leaves barely half a metre of clearance: you walk up
     to a table and the rail cuts across the felt, because you are looking at it
     almost edge-on. Everything in the building is modelled against this, so it
     is the one number that sets how the whole place feels to stand in. */
  const FLOOR_Y = -0.80;

  function carpetTexture(accent) {
    const size = 256;
    const c = global.document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#140d0c';
    g.fillRect(0, 0, size, size);

    // A diamond lattice with a fleuron in each cell. Casino carpet is loud on
    // purpose -- it hides everything that gets spilled on it -- and a plain
    // dark plane reads as nothing at all.
    g.strokeStyle = accent;
    g.globalAlpha = 0.16;
    g.lineWidth = 2;
    for (let i = -1; i <= 2; i++) {
      g.beginPath();
      g.moveTo(i * size, 0); g.lineTo(i * size + size, size);
      g.moveTo(i * size + size, 0); g.lineTo(i * size, size);
      g.stroke();
    }
    g.globalAlpha = 0.12;
    g.fillStyle = accent;
    for (const [x, y] of [[size / 2, size / 2], [0, 0], [size, 0], [0, size], [size, size]]) {
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2;
        g.ellipse(x + Math.cos(a) * 26, y + Math.sin(a) * 26, 15, 8, a, 0, Math.PI * 2);
      }
      g.fill();
    }
    g.globalAlpha = 0.06;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 2400; i++) {
      g.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(9, 9);
    tex.anisotropy = 4;
    return tex;
  }

  /* Baize.

     A flat colour reads as painted plastic under a spotlight. This gives the
     cloth a woven nap to catch the light, which is what a real table looks like
     with a lamp over the middle of it. */
  const feltCache = new Map();
  function feltTexture(hex) {
    const key = String(hex);
    if (feltCache.has(key)) return feltCache.get(key);
    const size = 512;
    const c = global.document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const base = new THREE.Color(hex);
    g.fillStyle = '#' + base.getHexString();
    g.fillRect(0, 0, size, size);

    // Nap: short strokes in two directions, the way cloth catches light.
    for (let i = 0; i < 9000; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const light = Math.random() < 0.5;
      g.strokeStyle = light ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.06)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 5, y + (Math.random() - 0.5) * 5);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.anisotropy = 4;

    const bump = new THREE.CanvasTexture(c);
    bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
    bump.repeat.set(9, 9);

    const out = { map: tex, bump };
    feltCache.set(key, out);
    return out;
  }

  /* A felt table. The playing surface is y = 0 in every game, and the pedestal
     below it reaches the room's floor, so a table is a thing standing on the
     ground rather than a disc hanging in the air. */
  function table(opts) {
    const o = Object.assign({ radius: 3.0, colour: 0x14472b, rail: 0x35211a, height: 0.0 }, opts);
    const g = new THREE.Group();

    const cloth = feltTexture(o.colour);
    const felt = new THREE.Mesh(
      new THREE.CircleGeometry(o.radius, 72),
      new THREE.MeshStandardMaterial({
        map: cloth.map, bumpMap: cloth.bump, bumpScale: 0.35,
        roughness: 0.97, metalness: 0.0,
      })
    );
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    g.add(felt);

    const railMat = new THREE.MeshPhysicalMaterial({
      color: o.rail, roughness: 0.32, clearcoat: 0.8, metalness: 0.0,
    });
    const rail = new THREE.Mesh(new THREE.TorusGeometry(o.radius + 0.10, 0.16, 14, 72), railMat);
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0.06;
    rail.castShadow = true;
    rail.receiveShadow = true;
    g.add(rail);

    /* Open-ended on purpose.

       A capped cylinder puts a disc at each end, and this one's top cap landed
       at exactly y = 0 -- the same plane as the felt. Two coplanar surfaces
       z-fight, and because both are triangle fans the fight came out as a
       sunburst of dark wedges radiating from the middle of every table in the
       building. It looked exactly like shadow acne, which cost an hour. */
    const apron = new THREE.Mesh(
      new THREE.CylinderGeometry(o.radius + 0.16, o.radius + 0.10, 0.34, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x160f0d, roughness: 0.85, side: THREE.DoubleSide })
    );
    apron.position.y = -0.18;
    apron.castShadow = true;
    g.add(apron);

    const drop = -FLOOR_Y - 0.34 - o.height;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(o.radius * 0.22, o.radius * 0.30, drop, 24),
      new THREE.MeshStandardMaterial({ color: 0x1c1310, roughness: 0.7, metalness: 0.2 })
    );
    column.position.y = -0.34 - drop / 2;
    column.castShadow = true;
    g.add(column);

    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(o.radius * 0.52, o.radius * 0.58, 0.10, 32),
      new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 0.9 })
    );
    foot.position.y = FLOOR_Y - o.height + 0.05;
    foot.receiveShadow = true;
    g.add(foot);

    g.position.y = o.height;
    return g;
  }

  /* A soft blob of shadow under an object. The shadow map handles real contact
     shadows; this fills in under things moving too fast for it, and under
     things drawn while the shadow map is switched off on a slow machine. */
  function contactShadow(radius, opacity) {
    const size = 128;
    const c = global.document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.85)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(c);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false,
                                    opacity: opacity === undefined ? 0.6 : opacity })
    );
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  global.GWStage = { create, table, contactShadow, carpetTexture, feltTexture, FLOOR_Y };
})(window);
