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
  const WALK = 3.1;
  const RUN = 5.0;
  const CROUCH_WALK = 1.5;
  const ACCEL = 14;
  /* Jumping.

     Real gravity at 9.81 m/s² gives a hang time that feels like the moon in a
     first-person game, so this is more than double it and the impulse is set to
     match: a 0.62 m apex reached in a bit over a third of a second, which is
     the shape every shooter has converged on. */
  const GRAVITY = 22;
  const JUMP = 5.2;
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
        if (state.active) jump();
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
      state.y = 0; state.vy = 0; state.grounded = true;
      state.crouching = false; state.height = EYE;
      state.bob = 0;
      state.nearest = null;
    }

    function eye(out) {
      return (out || new THREE.Vector3()).set(
        state.pos.x,
        state.y + state.height + (state.headBob ? Math.sin(state.bob) * 0.045 : 0),
        state.pos.z
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

      const k = 1 - Math.exp(-ACCEL * dt);
      state.vel.x += (wantX - state.vel.x) * k;
      state.vel.z += (wantZ - state.vel.z) * k;

      state.pos.x += state.vel.x * dt;
      state.pos.z += state.vel.z * dt;
      state.level.solids.resolve(state.pos, RADIUS);
      state.level.solids.bound(state.pos, RADIUS);

      /* Up and down. The floor is flat and the ceiling is well out of reach,
         so the whole of it is one number falling under gravity until it hits
         zero. Landing is announced, because a jump with no landing sound reads
         as the world having no floor. */
      state.vy -= GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y <= 0) {
        if (!state.grounded && state.vy < -3) audio.play('step');
        state.y = 0;
        state.vy = 0;
        state.grounded = true;
      }

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
      if (moved > 0.4 && state.grounded) {
        state.bob += dt * moved * 2.1;
        state.stepped += moved * dt;
        if (state.stepped > 1.5) { state.stepped = 0; audio.play('step'); }
      } else {
        state.bob += dt * 0.6;
        state.stepped = 1.2;
      }

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
      // A slight roll while strafing, which reads as weight without a wobble.
      stage.camera.rotation.z = -ix * 0.014;

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
