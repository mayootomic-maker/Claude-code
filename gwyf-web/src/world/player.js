/* Walking around in first person.

   Pointer lock for the mouse, WASD to move, and a circle-versus-box solver
   underneath so walls stop you and corners let you slide. The camera is driven
   directly here rather than through the stage's easing, because eased
   navigation feels like steering a boat; the easing is handed back for the
   move into and out of a machine, which is exactly where a smooth ride helps. */

(function (global) {
  'use strict';

  const EYE = 1.62;
  const RADIUS = 0.34;
  const WALK = 3.1;
  const RUN = 5.0;
  const ACCEL = 14;
  const REACH = 1.9;   // from the edge of a machine, not its centre
  const FOV_DOT = 0.32;        // roughly 70 degrees either side of straight ahead

  function create(opts) {
    const stage = opts.stage;
    const audio = opts.audio;
    const canvas = opts.canvas;

    const state = {
      pos: new THREE.Vector3(0, 0, 0),
      vel: new THREE.Vector3(),
      yaw: 0, pitch: 0,
      bob: 0, stepped: 0,
      active: false,
      locked: false,
      level: null,
      nearest: null,
      sensitivity: 0.0022,
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

    function onKeyDown(e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (MOVE_KEYS[e.code]) { keys.add(MOVE_KEYS[e.code]); e.preventDefault(); }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = true;
      if (e.code === 'KeyE' || e.code === 'Enter') {
        if (state.active && opts.onInteract) opts.onInteract(state.nearest);
      }
    }
    function onKeyUp(e) {
      if (MOVE_KEYS[e.code]) keys.delete(MOVE_KEYS[e.code]);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') state.sprinting = false;
    }
    function onBlur() { keys.clear(); state.sprinting = false; }

    function onMouseMove(e) {
      if (!state.locked || !state.active) return;
      state.yaw -= e.movementX * state.sensitivity;
      state.pitch -= e.movementY * state.sensitivity;
      clampPitch();
    }

    function clampPitch() {
      const limit = Math.PI / 2 - 0.08;
      state.pitch = Math.max(-limit, Math.min(limit, state.pitch));
    }

    function onLockChange() {
      state.locked = global.document.pointerLockElement === canvas;
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
      state.vel.set(0, 0, 0);
      state.bob = 0;
      state.nearest = null;
    }

    function eye(out) {
      return (out || new THREE.Vector3()).set(
        state.pos.x,
        EYE + Math.sin(state.bob) * 0.045,
        state.pos.z
      );
    }

    function forward(out) {
      return (out || new THREE.Vector3()).set(
        -Math.sin(state.yaw) * Math.cos(state.pitch),
        Math.sin(state.pitch),
        -Math.cos(state.yaw) * Math.cos(state.pitch)
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
        state.yaw -= state.lookDelta.x * 0.0045;
        state.pitch -= state.lookDelta.y * 0.0045;
        state.lookDelta.x = 0; state.lookDelta.y = 0;
        clampPitch();
      }

      let ix = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0);
      let iz = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0);
      ix += state.stick.x;
      iz += state.stick.y;
      const mag = Math.hypot(ix, iz);
      if (mag > 1) { ix /= mag; iz /= mag; }

      const speed = state.sprinting ? RUN : WALK;
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

      const moved = Math.hypot(state.vel.x, state.vel.z);
      if (moved > 0.4) {
        state.bob += dt * moved * 2.1;
        state.stepped += moved * dt;
        if (state.stepped > 1.5) { state.stepped = 0; audio.play('step'); }
      } else {
        state.bob += dt * 0.6;
        state.stepped = 1.2;
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
        state.pitch = Math.atan2(target.y - (EYE), flat);
        clampPitch();
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
