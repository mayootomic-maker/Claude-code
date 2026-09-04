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
    /* A third of a stop up. ACES rolls the top off hard, so the room was
       sitting in the toe of the curve where four deliberately different
       palettes all resolve to brown; the highlights it costs are the lamps,
       which are meant to clip. */
    renderer.toneMappingExposure = 1.32;
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
  /* Two fields of view, because the camera does two jobs.

     A table is a still life a metre across and it wants a long lens: 38
     degrees frames a coin without the barrel distortion a wide angle puts on
     everything near the edges. Walking wants the opposite. At 38 degrees a
     corridor is a tunnel, a wall two metres away fills the screen, turning
     feels twitchy because a small mouse movement sweeps a large part of what
     you can see, and you cannot tell where you are in a room because you can
     only see a sixth of it. Every first-person game is somewhere near 70.

     Using the table's lens to walk with is the reason this played like being
     led round the building with a toilet roll held to one eye. */
    let FOV_WALK = 72;
    const FOV_TABLE = 38;
    let fovTable = FOV_TABLE;
    const camera = new THREE.PerspectiveCamera(FOV_TABLE, 1, 0.05, 200);
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

    /* Deal the pool to the sites that will actually light the frame.

       Nearest-first was right while every site was a ceiling light of the same
       strength. It stopped being right the moment the rooms grew table lamps
       and machine name boards: those are deliberately weak and short ranged --
       intensity five over four metres, against twenty-two over fourteen for
       the ceiling -- and there are now three times as many of them. Stand at a
       table and all six slots go to lamps you happen to be beside, the ceiling
       grid loses every slot it had, and the room behind you goes out. Which is
       a floor that gets darker the closer you walk to something lit.

       So the key is what a site will contribute here rather than how close it
       is: intensity over distance squared, the way a point light actually
       falls off, and nothing beyond its own stated range counts at all. A lamp
       at your elbow still wins -- it is genuinely the brightest thing near you
       -- but a hall light twelve metres off now beats a lamp thirty metres
       away whose light does not reach you. */
    const dealt = [];
    function dealLights() {
      for (const kind of ['points', 'spots']) {
        const list = sites[kind] || [];
        const slots = pool[kind];
        dealt.length = 0;
        for (const site of list) {
          const d2 = camera.position.distanceToSquared(site.at);
          const range = site.distance || 12;
          site._d = d2 > range * range ? 0 : site.intensity / (d2 + 1);
          dealt.push(site);
        }
        dealt.sort((a, b) => b._d - a._d);
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i];
          const site = dealt[i];
          // A site out of its own range contributes nothing here, so the slot
          // is better off dark than spent on a light you cannot see.
          if (!site || site._d <= 0) { slot.intensity = 0; continue; }
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
    /* Kept low on purpose. A flat term lifts the dark side of everything
       equally, which is exactly what makes a room look unlit -- the hemisphere
       above does the lifting instead, and it keeps the tops of things brighter
       than their undersides while doing it. At 0.28 the characters, who are
       one flat pale colour, came out brighter than the lamps. */
    const ambient = new THREE.AmbientLight(0xffffff, 0.18);

    /* Sky-and-ground fill, in the colours of the room it is filling.

       A single ambient term flattens everything to one value; a hemisphere
       keeps the tops of things lighter than their undersides, which is most of
       what makes a room read as lit at all. Both were fixed warm -- amber over
       brown -- which meant the fill was the same on a magenta black-light floor
       and a cool marble vault, and every one of the four deliberately different
       palettes drifted back towards the same brown. It is set per floor now:
       the sky takes the room's own neon and the ground takes its carpet, so
       what bounces off the ceiling and up off the floor is what is actually in
       the room. */
    const sky = new THREE.HemisphereLight(0xffd9a8, 0x241713, 1.00);
    scene.add(sky);

    function setRoomLight(skyHex, groundHex, strength) {
      if (skyHex !== undefined && skyHex !== null) sky.color.set(skyHex);
      if (groundHex !== undefined && groundHex !== null) sky.groundColor.set(groundHex);
      sky.intensity = strength === undefined ? 1.00 : strength;
    }

    /* The lamp over the table.

       Every game centres its table on the origin, so one shade hung above the
       origin lights all twelve. It is what makes a casino table read as a
       casino table -- a bright pool with the room falling away around it -- and
       without it the felt came out near black however high the exposure went.
       No shadow: the directional light already casts them, and a second shadow
       map costs more than the light is worth. */
    /* The lamp over the table the player is at. In the world each machine has
       its own shade hung from the ceiling, so this one is switched off while
       walking and switched back on over whichever table is being played.

       It hangs over that table, wherever it is. It used to hang over the world
       origin, from back when a game was mounted at the origin and there was
       only ever one; once the machines were laid out across a thirty-metre
       hall the lamp stayed at nought-nought-nought lighting an empty patch of
       carpet, and every table you sat down at was a black rectangle. */
    const LAMP_ON = 42;
    const lamp = new THREE.SpotLight(0xffe0b4, LAMP_ON, 11, 0.82, 0.62, 1.5);
    lamp.position.set(0.25, 4.3, 0.9);
    lamp.target.position.set(0, 0.1, 0);
    scene.add(lamp, lamp.target);

    /* And one in front of it.

       A shade hung above a table lights a table. Half the machines are not
       tables: the slot cabinet, the drop board, the ladder and the climb are
       upright, and a light directly overhead grazes their faces and leaves the
       part you are looking at nearly black. Measured across all twelve, the
       flat ones came out at forty percent mean luminance and the upright ones
       at six. This sits where the camera sits and fills whatever face is
       pointed at you, whichever way the machine stands. */
    const FILL_ON = 16;
    // Fourteen metres of range, because the duck race is a lane and not a
    // table: at nine the far half of it fell outside the light entirely.
    const fill = new THREE.PointLight(0xfff0dc, FILL_ON, 12, 1.6);
    let fillWant = FILL_ON;
    scene.add(fill);

    /* Both are dimmed rather than hidden. Three compiles the light count into
       every material, so hiding a light recompiles every shader in the scene --
       a visible stall each time you sit down at a table or stand up from one.
       An intensity of zero costs a few multiplications and no compile. */
    function setTableLights(on) {
      lamp.intensity = on ? LAMP_ON : 0;
      fill.intensity = on ? fillWant : 0;
    }

    function setLampOver(point, from) {
      if (!point) return;
      lamp.position.set(point.x + 0.25, point.y + 4.2, point.z + 0.9);
      lamp.target.position.set(point.x, point.y + 0.1, point.z);
      lamp.target.updateMatrixWorld();
      // A third of the way back towards the camera and a little above it, so it
      // reads as the room's light rather than a torch strapped to your head.
      const eye = from || point;
      fill.position.set(
        point.x + (eye.x - point.x) * 0.62,
        point.y + (eye.y - point.y) * 0.62 + 0.5,
        point.z + (eye.z - point.z) * 0.62
      );
      /* Scaled with the square of how far it ended up, because the falloff is
         the physical one: a fixed intensity that suits a table watched from
         four metres blows the slot cabinet white when the wall behind it
         forces the camera in to one and a half. */
      const d = fill.position.distanceTo(point);
      // Bounded both ways. Unbounded, the square term turned the drop board
      // and the crash screen into white rectangles -- ninety percent mean
      // luminance, which is as unreadable as the black ones were.
      fillWant = FILL_ON * Math.max(0.45, Math.min(1.25, (d * d) / 9));
      if (lamp.intensity > 0) fill.intensity = fillWant;
    }

    const state = {
      running: false, last: 0, ticks: new Set(), env: null, envName: null,
      raf: 0, reduced: false, quality: 1, visible: true, manual: false,
      fov: FOV_TABLE, fovWant: FOV_TABLE, fovKick: 0, checks: 0,
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
      { dpr: 0.75, shadows: false, shadowSize: 512 },
      { dpr: 0.68, shadows: false, shadowSize: 512 },
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
      state.checks++;
      if (state.frameCost > 34 && state.tier < TIERS.length - 1) {
        // Well past a playable frame time: skip a tier rather than crawl down
        // one every second and a half while the player waits. Not on the first
        // check, though -- the first second and a half of a floor is spent
        // building it, and reading that as a slow machine left every player
        // permanently at the bottom tier because of one loading hitch.
        state.tier += (state.frameCost > 70 && state.checks > 1) ? 2 : 1;
        state.tier = Math.min(state.tier, TIERS.length - 1);
        applyTier();
      } else if (state.frameCost < 15 && state.tier > 0) {
        state.tier--;
        applyTier();
      }
    }

    const target = new THREE.Vector3(0, 0, 0);
    const desired = { pos: camera.position.clone(), look: target.clone(), ease: 3.2 };

    /* Colour separation, per floor.

       A back light in the room's accent colour, aimed across the player rather
       than from the camera. It does almost nothing to the brightness and a
       great deal to whether a table reads as an object in a room or a shape
       cut out of the wall behind it -- and it is what carries a floor's own
       colour on to everything standing in it. */
    function setAccent(hex) {
      rim.color.setHex(hex);
      rim.intensity = 1.35;
    }

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
      state.fov = state.fovWant + state.fovKick;
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
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

      /* Ease the lens rather than cutting it. Sitting down at a table is a
         push in; standing up is a pull out; sprinting widens it a few degrees,
         which is the oldest trick there is for making running feel fast and
         costs nothing. Reduced motion gets the destination immediately. */
      const wantFov = state.fovWant + state.fovKick;
      if (state.reduced) state.fov = wantFov;
      else state.fov += (wantFov - state.fov) * (1 - Math.exp(-9 * dt));
      if (Math.abs(camera.fov - state.fov) > 0.01) {
        camera.fov = state.fov;
        camera.updateProjectionMatrix();
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
      setEnvironment, resize, frame, snap, start, stop, onTick, clear, setLampOver, setAccent,
      setRoomLight,
      get envName() { return state.envName; },
      /* Pin the renderer where it is. Used by the mod menu's display page and
         by the screenshot harness, which wants a consistent frame rather than a
         fast one. */
      setQuality(q) { state.quality = q; state.auto = false; state.tier = 0; applyTier(); },
      /* Hand the camera to the first-person controller, or take it back. */
      setManualCamera(v) {
        state.manual = !!v;
        state.fovWant = state.manual ? FOV_WALK : fovTable;
        // Walking: the floor's own lamps light the room. At a table: the
        // stage lamp adds the pool of light the game was lit for.
        setTableLights(!state.manual);
      },
      get manualCamera() { return state.manual; },
      /* Where the camera is heading. Read by the harnesses, which have to wait
         for it to arrive rather than for a stopwatch -- and which cannot work
         it out for themselves, because the caller may have moved the shot to
         keep it inside the room. */
      get desired() { return { pos: desired.pos.clone(), look: desired.look.clone() }; },
      /* Extra degrees on top of whatever the mode asks for. Sprinting uses it. */
      setFovKick(deg) { state.fovKick = Math.max(-10, Math.min(14, deg || 0)); },
      /* How wide the walking lens is. A preference, because how wide is too
         wide depends on how far the person is sitting from the screen, and
         because a few people get motion sick at the wide end. The table's lens
         is not up for negotiation -- it is the shot the game was built around. */
      setWalkFov(deg) {
        FOV_WALK = Math.max(55, Math.min(100, deg || 72));
        if (state.manual) state.fovWant = FOV_WALK;
      },
      get walkFov() { return FOV_WALK; },
      /* Widen the table's lens when the room would not let the camera get far
         enough back. A machine against a wall in a crowded hall cannot always
         be watched from where it was framed to be watched from; a wider lens
         fits it in from where the camera can actually stand, which is what a
         camera operator does about the same problem. */
      setTableFov(deg) {
        fovTable = Math.max(FOV_TABLE, Math.min(66, deg || FOV_TABLE));
        if (!state.manual) state.fovWant = fovTable;
      },
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

  /* The carpet.

     This is the one surface the game is recognised by. Every interior shot of
     the original has it filling the bottom third of the frame: an ornate,
     high-contrast, four-colour Vegas carpet with medallions about a metre and
     a half across -- the kind woven loud on purpose, because a pattern that
     busy hides everything that gets spilled on it and gives a room with no
     windows something to be.

     What was here before was a near-black ground with the floor's accent
     stroked over it at twelve percent. Measured against seventeen of the
     original's own screenshots, this build came out a fifth darker overall,
     and the floor was where nearly all of that sat: the largest surface in
     every room was the emptiest.

     Four colours, not one, because a single accent over a dark ground is a
     texture and this needs to be a carpet: a ground, two motif colours that
     have to fight each other, and a light for the small stuff. Drawn at 512
     over a three-metre tile, so a medallion lands at roughly the size it does
     in the original rather than as a lozenge you have to crouch to see. */
  const carpetCache = new Map();
  function carpetTexture(palette, kind) {
    const p = Array.isArray(palette)
      // One colour still works, for anything that has not been given a set:
      // the ground goes dark, the motifs take the colour at two weights.
      ? palette
      : [shift(palette, 0.32), palette, shift(palette, 1.5), shift(palette, 2.2)];
    const key = p.join('|') + '|' + (kind || 'medallion');
    if (carpetCache.has(key)) return carpetCache.get(key);

    const size = 512;
    const c = global.document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = p[0];
    g.fillRect(0, 0, size, size);

    /* A lobed rosette, drawn in polar coordinates.

       Concentric rings whose radius wobbles with the angle, which is what
       separates a carpet medallion from a gear: the lobe count differs per
       ring so the edges never line up into spokes. */
    if (kind === 'novelty') {
      novelty(g, size, p);
      return finish(c, key);
    }

    /* Bands, not discs.

       Filled discs largest-first was the first attempt and it came out as a
       field of daisies: each medallion a solid blob, the lightest colour a
       wide plate in the middle, and the ground nowhere to be seen. What the
       original's carpets actually are is concentric *bands* with the dark
       ground showing between them -- so the ground colour is dealt back in
       every other ring, which is what makes a medallion instead of a stain,
       and the lightest colour gets one thin band rather than the centre. */
    const BANDS = [
      { r: 1.00, c: 2 }, { r: 0.88, c: 0 }, { r: 0.80, c: 1 },
      { r: 0.62, c: 0 }, { r: 0.54, c: 3 }, { r: 0.48, c: 1 },
      { r: 0.30, c: 0 }, { r: 0.22, c: 2 },
    ];
    function rosette(cx, cy, r, p) {
      BANDS.forEach((band, ring) => {
        // A different lobe count per ring, so the scallops never line up into
        // spokes -- which is the one thing that makes it read as a gear.
        const lobes = 8 + ring * 3;
        const wobble = 0.15 - ring * 0.013;
        g.fillStyle = p[band.c];
        g.beginPath();
        for (let a = 0; a <= 96; a++) {
          const t = (a / 96) * Math.PI * 2;
          const rad = r * band.r * (1 + Math.sin(t * lobes) * wobble);
          const x = cx + Math.cos(t) * rad, y = cy + Math.sin(t) * rad;
          if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        g.fill();
      });
    }

    /* A paisley: a teardrop with a curled tail, which is the shape every one
       of these carpets is built out of between the medallions. */
    function paisley(cx, cy, r, turn, fill) {
      g.save();
      g.translate(cx, cy);
      g.rotate(turn);
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(0, -r);
      g.bezierCurveTo(r * 0.9, -r * 0.7, r * 0.85, r * 0.35, 0, r);
      g.bezierCurveTo(-r * 0.5, r * 0.55, -r * 0.62, -r * 0.2, 0, -r);
      g.fill();
      g.restore();
    }

    // The medallion at the middle, and quarters of one at every corner, so the
    // tile joins into a continuous field rather than a grid of stamps.
    rosette(size / 2, size / 2, size * 0.27, p);
    for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
      rosette(x, y, size * 0.20, p);
    }

    // Paisleys on the diagonals between them, in pairs facing away from each
    // other -- a single one reads as a smudge, two read as a pattern.
    for (const [x, y] of [[size / 2, 0], [0, size / 2], [size, size / 2], [size / 2, size]]) {
      for (const side of [-1, 1]) {
        const turn = Math.atan2(size / 2 - y, size / 2 - x) + side * 0.9;
        paisley(x + side * size * 0.075, y, size * 0.085, turn, p[2]);
      }
    }

    // Scattered pips, on a fixed lattice rather than at random: a carpet is
    // woven, and a random scatter reads as dirt.
    g.fillStyle = p[3];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        if ((i + j) % 2) continue;
        const x = (i + 0.5) * size / 8, y = (j + 0.5) * size / 8;
        const d = Math.hypot(x - size / 2, y - size / 2);
        if (d < size * 0.30 || d > size * 0.44) continue;
        g.beginPath();
        g.arc(x, y, size * 0.012, 0, Math.PI * 2);
        g.fill();
      }
    }

    /* The pile.

       Every one of these carpets is woven coarsely enough that the pattern is
       visibly made of loops, and at a metre and a half a tile that reads. A
       lattice of ground-coloured dots over everything breaks the solid bands
       into a weave and takes about a fifth off the brightness at the same
       time, which is most of why the first version came out shouting. */
    g.globalAlpha = 0.4;
    g.fillStyle = p[0];
    for (let y = 0; y < size; y += 4) {
      for (let x = (y / 4) % 2 ? 2 : 0; x < size; x += 4) g.fillRect(x, y, 2, 2);
    }
    g.globalAlpha = 1;

    // And the nap, so the weave catches a lamp instead of reading as vinyl.
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
      g.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }

    return finish(c, key);
  }

  function finish(canvas, key) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    carpetCache.set(key, tex);
    return tex;
  }

  /* The novelty carpet.

     Not every room in the original has a medallion field: one of them is a
     navy floor strewn with oversized playing cards, dice and chips, at about
     a third of a metre each. It reads instantly as this game rather than as a
     hotel, and having a second kind is what stops four floors of medallions
     reading as one carpet recoloured -- which is the mistake the first pass at
     the whole building made.

     Everything is drawn nine times, offset by a tile in each direction, so a
     card that runs off one edge comes back on the other and the field is
     continuous instead of gridded. */
  function novelty(g, size, p) {
    g.fillStyle = p[0];
    g.fillRect(0, 0, size, size);

    const wrapped = (x, y, draw) => {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          g.save();
          g.translate(x + dx * size, y + dy * size);
          draw();
          g.restore();
        }
      }
    };
    // A fixed shuffle rather than Math.random: a floor rebuilt from the same
    // seed has to come out the same carpet.
    let seed = 0x9e3779b1;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const card = () => {
      g.fillStyle = p[3];
      round(g, -size * 0.055, -size * 0.078, size * 0.11, size * 0.156, size * 0.012);
      g.fill();
      g.fillStyle = p[1];
      g.beginPath();
      g.arc(0, 0, size * 0.026, 0, Math.PI * 2);
      g.fill();
    };
    const die = () => {
      g.fillStyle = p[1];
      round(g, -size * 0.055, -size * 0.055, size * 0.11, size * 0.11, size * 0.02);
      g.fill();
      g.fillStyle = p[3];
      for (const [ox, oy] of [[-0.03, -0.03], [0, 0], [0.03, 0.03]]) {
        g.beginPath();
        g.arc(ox * size, oy * size, size * 0.009, 0, Math.PI * 2);
        g.fill();
      }
    };
    const chip = () => {
      g.fillStyle = p[2];
      g.beginPath();
      g.arc(0, 0, size * 0.058, 0, Math.PI * 2);
      g.fill();
      // The dashes round the rim, which is what makes a disc a chip.
      g.strokeStyle = p[3];
      g.lineWidth = size * 0.016;
      for (let i = 0; i < 8; i++) {
        g.beginPath();
        g.arc(0, 0, size * 0.05, (i / 8) * Math.PI * 2, (i / 8) * Math.PI * 2 + 0.28);
        g.stroke();
      }
    };

    const shapes = [card, die, chip];
    // A jittered five-by-five lattice: scattered enough to read as strewn,
    // regular enough that no corner of the room comes out bare.
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = (i + 0.2 + rnd() * 0.6) * size / 5;
        const y = (j + 0.2 + rnd() * 0.6) * size / 5;
        const turn = rnd() * Math.PI * 2;
        const draw = shapes[Math.floor(rnd() * 3) % 3];
        wrapped(x, y, () => { g.rotate(turn); draw(); });
      }
    }

    for (let i = 0; i < 9000; i++) {
      g.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
      g.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    }
  }

  // A rounded rectangle, because a card with square corners is a domino.
  function round(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* What a carpet bounces onto the ceiling.

     The ground colour alone is too dark -- what comes back off a floor covered
     in orange medallions is orange -- and the motif alone is too strong. Half
     of each, which is roughly what the field averages to once the pattern is
     counted. */
  function carpetTint(palette) {
    const p = Array.isArray(palette) ? palette : [palette, palette];
    return new THREE.Color(p[0]).lerp(new THREE.Color(p[1]), 0.5);
  }

  // Same hue, a different weight of it. Used to make a set out of a floor that
  // only handed over one colour.
  function shift(hex, by) {
    const c = new THREE.Color(hex);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    c.setHSL(hsl.h, Math.min(1, hsl.s * (by > 1 ? 1.1 : 0.9)), Math.min(0.92, hsl.l * by));
    return '#' + c.getHexString();
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

  /* Wallpaper.

     A damask on the walls and a fine vertical stripe on the panelling: the two
     patterns a room like this has, at a scale you read as material rather than
     as pattern. Nothing here was possible until the fold learned to carry UVs
     -- a textured wall could not be merged, and an unmerged wall is a draw call
     per slab -- which is the whole reason every surface in the building was a
     flat colour with the palette painted on it.

     Deliberately low contrast. Wallpaper you can name from across a room is
     wallpaper you notice instead of the casino, and the point of it is to stop
     forty square metres of maroon reading as forty square metres of nothing.

     Cached by colour and kind, because four floors share two patterns and a
     canvas per wall is a canvas per wall. */
  const paperCache = new Map();
  function wallTexture(colour, kind) {
    const key = colour + ':' + kind;
    if (paperCache.has(key)) return paperCache.get(key);

    const size = 256;
    const c = global.document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    /* Papered walls are the most saturated thing in the original's rooms, and
       the palest thing here.

       Measured against seventeen of its own screenshots, this build sits a
       tenth under it on mean saturation with the brightness now matched --
       and the walls are where that lives, because a floor's wall hex was
       picked to sit quietly behind the tables and then got a texture drawn on
       it in tints of itself. Pushed a third harder here rather than in the
       four theme hexes, so the room light, the fog tint and everything else
       reading `theme.wall` keeps the colour it was tuned against and only the
       paper shouts. */
    const tint = new THREE.Color(colour);
    const hsl = { h: 0, s: 0, l: 0 };
    tint.getHSL(hsl);
    tint.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l);
    g.fillStyle = '#' + tint.getHexString();
    g.fillRect(0, 0, size, size);

    // Lighter and darker than the ground, so the pattern reads at any exposure
    // rather than only against a dark room.
    const up = '#' + tint.clone().lerp(new THREE.Color(0xffffff), 0.16).getHexString();
    const down = '#' + tint.clone().multiplyScalar(0.74).getHexString();

    if (kind === 'stripe') {
      // Panelling: a fine stripe, and a seam every quarter for the stile.
      for (let x = 0; x < size; x += 8) {
        g.fillStyle = (x / 8) % 2 ? up : down;
        g.globalAlpha = 0.22;
        g.fillRect(x, 0, 4, size);
      }
      g.globalAlpha = 0.5;
      g.fillStyle = down;
      for (let x = 0; x < size; x += 64) g.fillRect(x, 0, 3, size);
    } else {
      /* A damask: a lattice of four-lobed motifs, offset row to row. Drawn
         rather than sampled, so it tiles by construction -- a motif that runs
         off one edge is drawn again at the other. */
      const motif = (cx, cy, scale) => {
        g.beginPath();
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2;
          g.ellipse(cx + Math.cos(a) * 17 * scale, cy + Math.sin(a) * 17 * scale,
                    12 * scale, 6 * scale, a, 0, Math.PI * 2);
        }
        g.fill();
      };
      g.globalAlpha = 0.14;
      g.fillStyle = up;
      for (let row = -1; row <= 2; row++) {
        for (let col = -1; col <= 2; col++) {
          motif(col * 128 + (row % 2 ? 64 : 0), row * 128, 1);
        }
      }
      g.globalAlpha = 0.10;
      g.fillStyle = down;
      for (let row = -1; row <= 2; row++) {
        for (let col = -1; col <= 2; col++) {
          motif(col * 128 + (row % 2 ? 0 : 64) + 64, row * 128 + 64, 0.55);
        }
      }
    }

    // Tooth. Without it a flat fill under a flat light is still a flat fill.
    g.globalAlpha = 0.05;
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 2600; i++) g.fillRect(Math.random() * size, Math.random() * size, 1, 1);
    g.globalAlpha = 0.05;
    g.fillStyle = '#000000';
    for (let i = 0; i < 2600; i++) g.fillRect(Math.random() * size, Math.random() * size, 1, 1);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    paperCache.set(key, tex);
    return tex;
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

  global.GWStage = { create, table, contactShadow, carpetTexture, carpetTint,
                     feltTexture, wallTexture, FLOOR_Y };
})(window);
