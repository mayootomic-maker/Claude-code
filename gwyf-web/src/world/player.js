/* Walking around in first person.

   Pointer lock for the mouse, WASD to move, and a circle-versus-box solver
   underneath so walls stop you and corners let you slide. The camera is driven
   directly here rather than through the stage's easing, because eased
   navigation feels like steering a boat; the easing is handed back for the
   move into and out of a machine, which is exactly where a smooth ride helps. */

(function (global) {
  'use strict';

  const EYE = 1.62;
  const CROUCH_EYE = 1.05;
  const RADIUS = 0.34;
  /* How big a lip you walk up without jumping.

     Knee height. Below this a crate edge, a step or a kerb is something you
     stride over; above it, it is something to jump onto. The crate you wake in
     has shin-high walls at 0.62 on purpose, so it stays a wall on three sides
     and the fallen panel is still the way out. */
  const STEP_UP = 0.42;
  const WALK = 3.1;
  const RUN = 5.0;
  const CROUCH_WALK = 1.5;
  /* Getting going, stopping, and steering in mid-air.

     One acceleration for all three made walking feel like driving on ice in
     both directions: you slid away from a standstill and slid past where you
     meant to stop. Stopping is now sharper than starting, which is what makes
     a step read as a footfall rather than a drift, and air control is a
     fraction of either -- being able to turn on a sixpence with your feet off
     the ground is the single clearest tell that a first-person camera has no
     body under it. */
  const ACCEL = 16;
  const FRICTION = 24;
  const AIR_ACCEL = 1.3;
  /* Jumping.

     Real gravity at 9.81 m/s² gives a hang time that feels like the moon in a
     first-person game, so this is more than double it and the impulse is set to
     match: a 0.62 m apex reached in a bit over a third of a second, which is
     the shape every shooter has converged on. */
  /* Gravity and the jump, chosen together for a height rather than a feel.

     v^2 / 2g is the apex, and at 5.2 against 22 that was 0.61 m in theory and
     0.38 m measured -- less than the lowest crate in the yard's parkour, which
     is 0.55. The climb the movement was built for could not be started. A jump
     is worth about 0.95 m now, which clears a half-metre step comfortably and
     still cannot be used to leave the room: the walls are 5.4. */
  const GRAVITY = 22;
  const JUMP = 6.5;
  /* Press jump slightly before you land and it still fires. Every jump that
     "did not register" is this: the key went down two frames before the feet
     touched, and without a buffer those two frames eat the input. */
  const JUMP_BUFFER = 0.14;    // seconds
  /* Metres of camera dip per metre-per-second of impact. A normal jump lands
     at about five metres a second, so this is roughly nine centimetres of
     knee -- enough to feel, small enough not to read as the floor giving way.
     The first pass was three times this and looked like a stumble. */
  const LAND_DIP = 0.018;
  const DIP_SPRING = 120;      // how hard the knees push back
  const DIP_DAMP = 15;
  const CROUCH_RATE = 9;       // how fast you drop and stand back up
  const REACH = 1.9;   // from the edge of a machine, not its centre
  const FOV_DOT = 0.32;        // roughly 70 degrees either side of straight ahead

  /* The first mouse event after a lock is not a mouse movement.

     `movementX` is the distance from the pointer's previous position, and
     taking the lock warps the pointer to the middle of the screen -- so the
     first event after the warp reports the distance from wherever you clicked
     to wherever the browser put it. That arrives as one delta of several
     hundred pixels and throws the view at the ceiling the instant you click to
     play, which is not something you can recover from by moving the mouse back:
     it is a real turn, and it happens again every time you click in.

     So the first event after a lock is dropped, and everything after it is
     clamped. A real mouse reports a few dozen pixels per event even when it is
     flicked across a desk; a single event past MAX_STEP is the browser having a
     moment rather than a person moving their hand. */
  const MAX_STEP = 140;
  const SETTLE = 80;           // ms after a lock in which deltas are still suspect

  function create(opts) {
    const stage = opts.stage;
    const audio = opts.audio;
    const canvas = opts.canvas;

    const state = {
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      bob: 0, stepped: 0,
      // Vertical, which the collision solver knows nothing about: the floor is
      // flat, so the ground is always y = 0 and a jump is one number.
      y: 0, vy: 0, grounded: true,
      crouching: false, height: EYE,
      // What the camera is actually pointing at, which trails the input when
      // camera smoothing is on. The real game eases this and lets you turn it
      // off; both are here for the same reason.
      viewYaw: 0, viewPitch: 0, smoothing: 0, headBob: true,
      dip: 0, dipV: 0, jumpAt: 0, sway: 0, lastStep: 0,
      active: false,
      locked: false,
      level: null,
      nearest: null,
      sensitivity: 0.0022,
      invert: false,
      lockedAt: 0,
      warmup: false,
      // Touch devices drive these instead of the keyboard.
      stick: { x: 0, y: 0 },
      lookDelta: { x: 0, y: 0 },
      sprinting: false,
    };

    const keys = new Set();
    const MOVE_KEYS = {
      KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b',
      KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
    };
    const CROUCH_KEYS = { ControlLeft: 1, ControlRight: 1, KeyC: 1 };

    function onKeyDown(e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (MOVE_KEYS[e.code]) { keys.add(MOVE_KEYS[e.code]); e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = true;
      if (CROUCH_KEYS[e.code]) { state.crouching = true; e.preventDefault(); }
      if (e.code === 'Space') {
        // Held space must not machine-gun the jump; the ground check does that
        // on its own, but the browser also scrolls on space by default.
        e.preventDefault();
        // Remembered for a moment, so a press that lands a frame or two before
        // the feet do still counts. Without this the jump you queued while
        // falling is simply thrown away, which reads as the key not working.
        if (state.active) { state.jumpAt = JUMP_BUFFER; jump(); }
      }
      if (e.code === 'KeyE' || e.code === 'Enter') {
        if (state.active && opts.onInteract) opts.onInteract(state.nearest);
      }
    }
    function onKeyUp(e) {
      if (MOVE_KEYS[e.code]) keys.delete(MOVE_KEYS[e.code]);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = false;
      if (CROUCH_KEYS[e.code]) state.crouching = false;
    }
    function onBlur() { keys.clear(); state.sprinting = false; state.crouching = false; }

    function jump() {
      if (!state.grounded) return;
      state.vy = JUMP;
      state.grounded = false;
      state.jumpAt = 0;         // spent; do not fire again on landing
      // A small crouch on the way up, so the launch has a wind-up rather than
      // teleporting the camera off the floor.
      state.dip -= 0.035;
      audio.play('step');
    }

    function onMouseMove(e) {
      if (!state.locked || !state.active) return;
      if (state.warmup) {
        // One event, or any event inside the settling window, whichever lasts
        // longer -- browsers differ on how many they emit across the warp.
        state.warmup = false;
        if (global.performance.now() - state.lockedAt < SETTLE) return;
      }
      const dx = Math.max(-MAX_STEP, Math.min(MAX_STEP, e.movementX || 0));
      const dy = Math.max(-MAX_STEP, Math.min(MAX_STEP, e.movementY || 0));
      state.yaw -= dx * state.sensitivity;
      state.pitch -= dy * state.sensitivity * (state.invert ? -1 : 1);
      clampPitch();
    }

    function clampPitch() {
      const limit = Math.PI / 2 - 0.08;
      state.pitch = Math.max(-limit, Math.min(limit, state.pitch));
    }

    function onLockChange() {
      state.locked = global.document.pointerLockElement === canvas;
      if (state.locked) {
        state.lockedAt = global.performance.now();
        state.warmup = true;
      }
      if (opts.onLockChange) opts.onLockChange(state.locked);
      if (!state.locked) keys.clear();
    }

    global.addEventListener('keydown', onKeyDown);
    global.addEventListener('keyup', onKeyUp);
    global.addEventListener('blur', onBlur);
    global.document.addEventListener('mousemove', onMouseMove);
    global.document.addEventListener('pointerlockchange', onLockChange);

    function lock() {
      if (!canvas.requestPointerLock) return;
      // Chrome rejects the request if one is already in flight; a rejected
      // promise here is not an error worth surfacing.
      const req = canvas.requestPointerLock({ unadjustedMovement: true });
      if (req && req.catch) req.catch(() => { try { canvas.requestPointerLock(); } catch (e) { /* denied */ } });
    }

    function unlock() {
      if (global.document.pointerLockElement === canvas) global.document.exitPointerLock();
    }

    function enter(level) {
      state.level = level;
      state.pos.set(level.spawn.x, 0, level.spawn.z);
      state.yaw = level.spawn.angle;
      state.pitch = -0.05;
      state.viewYaw = state.yaw;
      state.viewPitch = state.pitch;
      state.vel.set(0, 0, 0);
      state.y = level.solids.groundAt(level.spawn.x, level.spawn.z, RADIUS, Infinity);
      state.vy = 0; state.grounded = true;
      state.crouching = false; state.height = EYE;
      state.bob = 0;
      state.nearest = null;
    }

    /* Where the head is.

       Height plus the walk in it plus the knees. The sway is applied across the
       direction of travel rather than in world space, so leaning is always to
       your left and right whichever way you are facing. */
    function eye(out) {
      const v = out || new THREE.Vector3();
      const bob = state.headBob ? Math.sin(state.bob) * 0.045 : 0;
      const sway = state.headBob ? state.sway : 0;
      const cos = Math.cos(state.viewYaw), sin = Math.sin(state.viewYaw);
      return v.set(
        state.pos.x + cos * sway,
        state.y + state.height + bob + state.dip,
        state.pos.z - sin * sway
      );
    }

    /* Where the camera is pointing. Everything that asks what the player is
       looking at asks this, including the interaction test -- aiming off the
       input angle while the camera trails behind it means the prompt appears
       for a machine that is not on screen yet. */
    function forward(out) {
      return (out || new THREE.Vector3()).set(
        -Math.sin(state.viewYaw) * Math.cos(state.viewPitch),
        Math.sin(state.viewPitch),
        -Math.cos(state.viewYaw) * Math.cos(state.viewPitch)
      );
    }

    const tmpEye = new THREE.Vector3();
    const tmpFwd = new THREE.Vector3();
    const tmpTo = new THREE.Vector3();

    function update(dt) {
      if (!state.active || !state.level) return;

      // Touch look is applied as a delta because there is no pointer lock on a
      // phone; the keyboard path goes through mousemove instead.
      if (state.lookDelta.x || state.lookDelta.y) {
        // Touch drags are scaled off the same setting, so one sensitivity
        // control covers both ways of playing.
        const k = state.sensitivity * 2.0;
        state.yaw -= state.lookDelta.x * k;
        state.pitch -= state.lookDelta.y * k * (state.invert ? -1 : 1);
        state.lookDelta.x = 0; state.lookDelta.y = 0;
        clampPitch();
      }

      let ix = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
      let iz = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0);
      ix += state.stick.x;
      iz += state.stick.y;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; }

      // Crouching beats sprinting: holding both should not be a fast crouch.
      const speed = state.crouching ? CROUCH_WALK : state.sprinting ? RUN : WALK;
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      // Forward is -Z rotated by yaw; strafe is its perpendicular.
      const wantX = (-sin * iz + cos * ix) * speed;
      const wantZ = (-cos * iz - sin * ix) * speed;

      /* Three rates, picked by what the body is doing. Slowing down beats
         speeding up so you plant when you let go; in the air you barely steer
         at all. */
      const wanted = mag > 0.001;
      const rate = !state.grounded ? AIR_ACCEL : wanted ? ACCEL : FRICTION;
      const k = 1 - Math.exp(-rate * dt);
      state.vel.x += (wantX - state.vel.x) * k;
      state.vel.z += (wantZ - state.vel.z) * k;

      state.pos.x += state.vel.x * dt;
      state.pos.z += state.vel.z * dt;
      /* Anything shorter than the step is walked over, not into.

         Going up, the lip has to be reachable from where the feet are; going
         down, only what is already under them counts, or stepping off a crate
         would snap you sideways onto the next one. */
      state.level.solids.resolve(state.pos, RADIUS, state.y,
        state.grounded ? STEP_UP : 0);
      state.level.solids.bound(state.pos, RADIUS);

      /* Up and down.

         There is a floor under you rather than *the* floor: whatever you are
         stood over, at whatever height its top is. Everything in this world
         used to be an infinitely tall wall over a single plane at zero, so a
         crate could be walked into and never stood on and the run of them in
         the yard was scenery with a ticket on it. Landing is announced,
         because a jump with no landing sound reads as the world having no
         floor. */
      const under = state.level.solids.groundAt(state.pos.x, state.pos.z, RADIUS,
        state.grounded ? state.y + STEP_UP : state.y + 0.02);
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      // Walking onto a low lip: taken as a step rather than a fall, so a kerb
      // does not read as the ground dropping and coming back.
      if (state.grounded && under > state.y && under - state.y <= STEP_UP) {
        state.y = under;
        state.vy = 0;
      }
      if (state.y <= under) {
        if (!state.grounded) {
          const impact = -state.vy;
          if (impact > 3) audio.play('step');
          // Knees. The camera drops with the impact and springs back, which is
          // most of what tells you the jump had a landing rather than a stop.
          state.dip -= Math.min(0.10, impact * LAND_DIP);
        }
        state.y = under;
        state.vy = 0;
        state.grounded = true;
      } else if (state.grounded && state.y > under + 0.02) {
        // Walked off the edge of something. Falling, not floating.
        state.grounded = false;
      }

      // A buffered jump fires the moment the feet are down.
      state.jumpAt -= dt;
      if (state.jumpAt > 0 && state.grounded) { state.jumpAt = 0; jump(); }

      /* The dip is a critically damped spring rather than a fade, so it comes
         back up through the resting height and settles instead of sagging to
         it. Landing hard is a bounce; landing gently is barely there. */
      const dipA = -state.dip * DIP_SPRING - state.dipV * DIP_DAMP;
      state.dipV += dipA * dt;
      state.dip += state.dipV * dt;

      const wantHeight = state.crouching ? CROUCH_EYE : EYE;
      state.height += (wantHeight - state.height) * Math.min(1, CROUCH_RATE * dt);

      const moved = Math.hypot(state.vel.x, state.vel.z);

      /* Widen the lens as you get up to speed. It is proportional to how fast
         you are actually going rather than to the shift key being down, so
         setting off and stopping are the same gesture in both directions and
         running into a wall does not leave the view stretched. */
      const over = Math.max(0, moved - WALK) / Math.max(0.1, RUN - WALK);
      stage.setFovKick(Math.min(1, over) * 7);
      // No head bob in mid-air: bobbing while your feet are off the ground is
      // the one place it stops reading as footsteps and starts reading as a
      // camera fault.
      /* Footsteps on the footfall.

         The step sound used to fire off a distance counter, so it drifted out
         of phase with the camera's own bob and you heard a foot land while the
         head was on its way up. The bob is the gait; a step is the bottom of
         it. Two per cycle, because you have two feet. */
      if (moved > 0.4 && state.grounded) {
        state.bob += dt * moved * 2.1;
        const phase = Math.floor(state.bob / Math.PI);
        if (phase !== state.lastStep) { state.lastStep = phase; audio.play('step'); }
      } else {
        // Idle breathing, slow enough not to read as walking on the spot.
        state.bob += dt * 0.6;
        state.lastStep = Math.floor(state.bob / Math.PI);
      }
      // Side to side at half the up-and-down rate: one sway per full stride,
      // two dips. Anything faster reads as a limp.
      state.sway = Math.sin(state.bob * 0.5) * Math.min(0.028, moved * 0.009);

      /* Camera smoothing.

         The real game eases the view and lets you turn that off, which is the
         difference between a camera that feels weighty and one that feels
         loose. Zero smoothing is exact 1:1 tracking; the setting is a time
         constant, so the same value behaves the same at any frame rate. */
      if (state.smoothing > 0.001) {
        const k = 1 - Math.exp(-dt / (state.smoothing * 0.12));
        let d = state.yaw - state.viewYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        state.viewYaw += d * k;
        state.viewPitch += (state.pitch - state.viewPitch) * k;
      } else {
        state.viewYaw = state.yaw;
        state.viewPitch = state.pitch;
      }

      // Camera
      eye(tmpEye);
      forward(tmpFwd);
      stage.camera.position.copy(tmpEye);
      stage.camera.lookAt(tmpEye.x + tmpFwd.x, tmpEye.y + tmpFwd.y, tmpEye.z + tmpFwd.z);
      // A slight roll while strafing, plus a little from the gait itself, which
      // reads as weight without a wobble.
      stage.camera.rotation.z = -ix * 0.014 + (state.headBob ? state.sway * 0.35 : 0);

      // The shadow camera covers a small area, so it follows the player instead
      // of sitting over the middle of a room they may be nowhere near.
      stage.key.position.set(state.pos.x - 3.2, 6.0, state.pos.z + 2.6);
      stage.key.target.position.set(state.pos.x, 0, state.pos.z);
      stage.key.target.updateMatrixWorld();

      state.nearest = findNearest();
    }

    /* What the player is close to and looking at. A cone test rather than a
       ray: a ray demands you point at the exact pixel of a machine, and every
       game that does that feels broken even though it is technically precise. */
    function findNearest() {
      const level = state.level;
      if (!level || !level.anchors.length) return null;
      forward(tmpFwd);
      tmpFwd.y = 0;
      tmpFwd.normalize();
      let best = null, bestScore = -Infinity;
      for (const anchor of level.anchors) {
        // Distance to the machine's footprint, so a big table is usable from
        // where you can actually stand and a small one still needs you close.
        const half = anchor.half || { hw: 0, hd: 0 };
        const ox = Math.max(0, Math.abs(state.pos.x - anchor.position.x) - half.hw);
        const oz = Math.max(0, Math.abs(state.pos.z - anchor.position.z) - half.hd);
        const dist = Math.hypot(ox, oz);
        if (dist > REACH) continue;
        tmpTo.set(anchor.position.x - state.pos.x, 0, anchor.position.z - state.pos.z);
        tmpTo.normalize();
        const facing = tmpTo.dot(tmpFwd);
        if (facing < FOV_DOT) continue;
        const score = facing - dist * 0.2;
        if (score > bestScore) { bestScore = score; best = anchor; }
      }
      if (!best) return null;
      return { anchor: best, distance: state.pos.distanceTo(best.position) };
    }

    function inLift() {
      const level = state.level;
      if (!level) return false;
      return Math.abs(state.pos.x - level.lift.x) < level.lift.w / 2
          && Math.abs(state.pos.z - level.lift.z) < level.lift.d / 2;
    }

    return {
      state,
      enter, update, lock, unlock, eye, forward, inLift,
      /* Jump, for anything that is not the spacebar.

         A touchscreen has no spacebar and the yard has a parkour with a ticket
         on top of it, so a phone could reach every part of this game except
         that one. Exposed as the same call the key makes -- buffer and all --
         rather than as a flag somebody else sets, because the buffer is the
         reason a press that lands just before your feet do still counts, and a
         second way in that skipped it would jump differently. */
      jump() { if (state.active) { state.jumpAt = JUMP_BUFFER; jump(); } },
      get active() { return state.active; },
      set active(v) {
        state.active = !!v;
        if (!v) { keys.clear(); state.nearest = null; }
      },
      get locked() { return state.locked; },
      /* Look settings, applied live. Kept here rather than read from the store
         every frame so the controller stays the only thing that knows how a
         mouse becomes an angle. */
      setLook(opts_) {
        if (typeof opts_.sensitivity === 'number' && opts_.sensitivity > 0) {
          state.sensitivity = opts_.sensitivity;
        }
        if (typeof opts_.invert === 'boolean') state.invert = opts_.invert;
        if (typeof opts_.smoothing === 'number') {
          state.smoothing = Math.max(0, Math.min(1, opts_.smoothing));
        }
        if (typeof opts_.headBob === 'boolean') state.headBob = opts_.headBob;
      },
      jump,
      get nearest() { return state.nearest; },
      /* Turn to face a point in the world -- the machine's own focal point,
         which for a table is the middle of the felt and for a slot cabinet is
         the payline. Aiming at the centre of the footprint instead leaves you
         staring level across the top of the table you walked up to. */
      lookAt(target) {
        const dx = target.x - state.pos.x;
        const dz = target.z - state.pos.z;
        state.yaw = Math.atan2(-dx, -dz);
        const flat = Math.hypot(dx, dz) || 1e-6;
        state.pitch = Math.atan2(target.y - (state.y + state.height), flat);
        clampPitch();
        // Turning to face something is a cut, not a pan: the smoothed view has
        // to arrive with it or the aim test and the picture disagree.
        state.viewYaw = state.yaw;
        state.viewPitch = state.pitch;
      },
      dispose() {
        global.removeEventListener('keydown', onKeyDown);
        global.removeEventListener('keyup', onKeyUp);
        global.removeEventListener('blur', onBlur);
        global.document.removeEventListener('mousemove', onMouseMove);
        global.document.removeEventListener('pointerlockchange', onLockChange);
      },
      EYE, RADIUS,
    };
  }

  global.GWPlayer = { create, EYE, RADIUS };
})(window);
