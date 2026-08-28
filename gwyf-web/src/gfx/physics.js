/* Rigid-body dice.

   The roll is a real cannon.js simulation -- the dice bounce off each other and
   off the rail, and no two throws look alike. What is *not* left to the physics
   is which number comes up. The outcome is drawn from the seeded RNG first,
   because a physics engine is not a fair die: the outcome depends on the throw's
   initial conditions, on the solver's iteration count, and on floating point,
   none of which are uniform and none of which can be stated in an odds table.

   So: draw the number, simulate the throw, see which face the simulation
   happened to leave on top, and rotate the die's *mesh inside its body* by one
   of the cube's own 24 symmetries so the drawn number is the one facing up. The
   motion is untouched and the geometry is identical under that rotation, so
   there is nothing to see -- and the odds are exactly the ones on the label. */

(function (global) {
  'use strict';

  const STEP = 1 / 120;
  const RECORD = 1 / 60;
  const MAX_SECONDS = 6;

  /* The 24 rotations that map a cube onto itself. Generated rather than typed
     out, because a hand-written list with one wrong sign produces a die that is
     subtly mirrored and nobody can say why. */
  function cubeSymmetries() {
    const out = [];
    const axes = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
    ];
    for (const x of axes) {
      for (const y of axes) {
        if (Math.abs(x.dot(y)) > 1e-6) continue;
        const z = new THREE.Vector3().crossVectors(x, y);
        const m = new THREE.Matrix4().makeBasis(x, y, z);
        if (m.determinant() < 0) continue;
        out.push(new THREE.Quaternion().setFromRotationMatrix(m));
      }
    }
    return out;
  }

  const SYMMETRIES = cubeSymmetries();

  function upFace(quat, faces) {
    let best = null, bestDot = -Infinity;
    const v = new THREE.Vector3();
    for (const f of faces) {
      v.set(f.normal[0], f.normal[1], f.normal[2]).applyQuaternion(quat);
      if (v.y > bestDot) { bestDot = v.y; best = f; }
    }
    return best;
  }

  /* A symmetry that carries `wanted`'s normal onto `landed`'s normal. Four of
     the 24 qualify; any of them will do, and taking a different one each throw
     stops the same pips facing the camera every time. */
  function correction(wanted, landed, rng) {
    const from = new THREE.Vector3().fromArray(wanted.normal);
    const to = new THREE.Vector3().fromArray(landed.normal);
    const v = new THREE.Vector3();
    const hits = [];
    for (const q of SYMMETRIES) {
      v.copy(from).applyQuaternion(q);
      if (v.distanceToSquared(to) < 1e-6) hits.push(q);
    }
    if (!hits.length) return new THREE.Quaternion();
    return hits[Math.floor((rng ? rng.next() : Math.random()) * hits.length) % hits.length];
  }

  /* Throw `values.length` dice into a bowl of radius `radius` and record the
     whole flight. Replaying a recording rather than stepping the world inside
     the render loop keeps the animation identical no matter what the frame rate
     does, and lets the throw be retried when a die ends up somewhere silly
     before the player has seen anything. */
  function rollDice(opts) {
    const rng = opts.rng;
    const faces = opts.faces;
    const size = opts.size || 1;
    const radius = opts.radius || 2.2;
    const values = opts.values;

    for (let attempt = 0; attempt < 8; attempt++) {
      const take = simulate(values.length, rng, size, radius, opts.wallHeight || 1.2);
      if (!take) continue;
      const tracks = take.bodies.map((rec, i) => {
        const finalQ = new THREE.Quaternion(rec.q[rec.q.length - 4], rec.q[rec.q.length - 3],
                                            rec.q[rec.q.length - 2], rec.q[rec.q.length - 1]);
        const landed = upFace(finalQ, faces);
        const wanted = faces.find((f) => f.value === values[i]);
        return {
          frames: rec.frames,
          p: rec.p, q: rec.q,
          landed: landed.value,
          value: values[i],
          fix: correction(wanted, landed, rng),
        };
      });
      return { tracks, duration: take.frames * RECORD, frames: take.frames };
    }
    return null;
  }

  function simulate(count, rng, size, radius, wallHeight) {
    const world = new CANNON.World();
    world.gravity.set(0, -32, 0);   // heavier than earth: a real-gravity die
    world.broadphase = new CANNON.NaiveBroadphase();  // dozens of bodies at most
    world.solver.iterations = 14;
    world.allowSleep = true;

    const feltMat = new CANNON.Material('felt');
    const diceMat = new CANNON.Material('dice');
    world.addContactMaterial(new CANNON.ContactMaterial(feltMat, diceMat, {
      friction: 0.28, restitution: 0.32,
    }));
    world.addContactMaterial(new CANNON.ContactMaterial(diceMat, diceMat, {
      friction: 0.10, restitution: 0.44,
    }));

    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: feltMat });
    ground.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.add(ground);

    // A ring of walls rather than a cylinder: cannon 0.6 has no cylinder-box
    // contact worth trusting, and sixteen planes are indistinguishable from a
    // circle once a die has hit one.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: feltMat });
      // A cannon plane faces +Z in its own frame. To face the middle of the
      // bowl from a point on the rim it has to turn by -(a + 90 degrees); the
      // obvious a + 180 leaves every wall facing along the rim instead of
      // across it, and the dice sail straight through.
      wall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -(a + Math.PI / 2));
      wall.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      world.add(wall);
    }

    const half = size / 2;
    const bodies = [];
    for (let i = 0; i < count; i++) {
      const body = new CANNON.Body({
        mass: 1,
        shape: new CANNON.Box(new CANNON.Vec3(half, half, half)),
        material: diceMat,
        linearDamping: 0.06,
        angularDamping: 0.06,
      });
      const spread = 0.55;
      body.position.set(
        (rng.next() - 0.5) * spread - radius * 0.55,
        1.6 + i * 0.85 + rng.next() * 0.4,
        (rng.next() - 0.5) * spread
      );
      body.quaternion.setFromEuler(rng.float(0, 6.28), rng.float(0, 6.28), rng.float(0, 6.28));
      body.velocity.set(rng.float(4.0, 6.2), rng.float(-0.6, 1.4), rng.float(-1.8, 1.8));
      body.angularVelocity.set(rng.float(-18, 18), rng.float(-18, 18), rng.float(-18, 18));
      body.allowSleep = true;
      body.sleepSpeedLimit = 0.14;
      body.sleepTimeLimit = 0.28;
      world.add(body);
      bodies.push({ body, p: [], q: [], frames: 0 });
    }

    let time = 0, sinceRecord = RECORD, frames = 0;
    let settledFor = 0;
    while (time < MAX_SECONDS) {
      world.step(STEP);
      time += STEP;
      sinceRecord += STEP;
      if (sinceRecord >= RECORD) {
        sinceRecord -= RECORD;
        for (const rec of bodies) {
          rec.p.push(rec.body.position.x, rec.body.position.y, rec.body.position.z);
          rec.q.push(rec.body.quaternion.x, rec.body.quaternion.y,
                     rec.body.quaternion.z, rec.body.quaternion.w);
        }
        frames++;
      }
      const moving = bodies.some((r) => r.body.velocity.lengthSquared() > 0.02
                                     || r.body.angularVelocity.lengthSquared() > 0.06);
      settledFor = moving ? 0 : settledFor + STEP;
      if (settledFor > 0.35 && frames > 30) break;
    }

    for (const rec of bodies) rec.frames = frames;

    // A die that ended up on its edge against a wall, or outside the bowl,
    // means the throw is unusable -- the caller throws again.
    for (const rec of bodies) {
      const y = rec.p[rec.p.length - 2];
      const x = rec.p[rec.p.length - 3];
      const z = rec.p[rec.p.length - 1];
      if (y < size * 0.30 || y > size * 0.95) return null;
      if (Math.hypot(x, z) > radius - size * 0.62) return null;
    }
    return { bodies, frames };
  }

  /* Read a recorded track at a point in time, writing into a three object. */
  function apply(track, object, seconds) {
    const total = track.p.length / 3;
    const raw = seconds / RECORD;
    const i = Math.min(Math.floor(raw), total - 1);
    const j = Math.min(i + 1, total - 1);
    const t = Math.min(Math.max(raw - i, 0), 1);
    object.position.set(
      track.p[i * 3] + (track.p[j * 3] - track.p[i * 3]) * t,
      track.p[i * 3 + 1] + (track.p[j * 3 + 1] - track.p[i * 3 + 1]) * t,
      track.p[i * 3 + 2] + (track.p[j * 3 + 2] - track.p[i * 3 + 2]) * t
    );
    const qa = new THREE.Quaternion(track.q[i * 4], track.q[i * 4 + 1],
                                    track.q[i * 4 + 2], track.q[i * 4 + 3]);
    const qb = new THREE.Quaternion(track.q[j * 4], track.q[j * 4 + 1],
                                    track.q[j * 4 + 2], track.q[j * 4 + 3]);
    object.quaternion.copy(qa.slerp(qb, t));
    return raw >= total - 1;
  }

  global.GWPhysics = { rollDice, apply, upFace, cubeSymmetries, RECORD };
})(window);

/* --- plinko ---------------------------------------------------------------
   A ball dropped through a peg field, simulated for real and then replayed.

   Nothing decides where it lands except the board: the only randomness is the
   sub-millimetre jitter on the release point, exactly as with a physical one.
   That means the payout table cannot be reasoned about from a binomial -- the
   pegs are round and the ball is bouncy, so the real distribution is wider in
   the middle and thinner at the edges. tools/odds.mjs measures it over tens of
   thousands of drops and the odds panel prints what it measured. */
(function (global) {
  'use strict';

  const STEP = 1 / 180;
  const RECORD = 1 / 60;

  function plinkoBoard(rows, pitch) {
    /* A full-width staggered lattice, not a triangle.

       A triangular field leaves an open channel down each side, and a ball that
       slips outside the last peg reaches an edge slot without having made the
       run of same-way bounces that is supposed to be what an edge slot costs --
       measured, that put nine percent of drops in the outermost pocket. Here
       every row spans the whole board and the outer pegs sit against the walls,
       so the only way to the edge is through the pegs. */
    const slots = rows + 1;
    const half = slots / 2;                 // 6.5 for thirteen slots
    const pegs = [];
    for (let r = 0; r < rows; r++) {
      const y = -r * pitch * 0.86;
      if (r % 2 === 0) {
        for (let i = 0; i <= slots; i++) pegs.push({ x: (i - half) * pitch, y });
      } else {
        for (let i = 0; i < slots; i++) pegs.push({ x: (i - half + 0.5) * pitch, y });
      }
    }
    return {
      pegs, rows, pitch, slots, half,
      wallX: half * pitch,
      bottom: -(rows - 1) * pitch * 0.86 - pitch * 1.3,
    };
  }

  function dropPlinko(opts) {
    const board = opts.board;
    const rng = opts.rng;
    // Peg and ball sized so the ball must squeeze past a peg on every row: the
    // gap between neighbouring pegs is 0.62 of the pitch and the ball is 0.52 of
    // it, leaving just enough clearance to fall through and not enough to fall
    // through untouched. Smaller pegs and the ball dribbles straight down the
    // middle, which is what the first board did -- two thirds of every drop
    // landed in the centre slot.
    const ballR = opts.ballRadius || board.pitch * 0.26;
    const pegR = opts.pegRadius || board.pitch * 0.19;
    const bias = opts.bias || 0;

    const world = new CANNON.World();
    world.gravity.set(0, -18, 0);
    // Sweep-and-prune, not naive: a plinko board is ninety-odd static bodies,
    // and the naive broadphase tests every pair every step, which turns a
    // measurable payout table into a job that never finishes.
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 12;

    const wood = new CANNON.Material('wood');
    const rubber = new CANNON.Material('rubber');
    world.addContactMaterial(new CANNON.ContactMaterial(wood, rubber, {
      friction: 0.01, restitution: 0.42,
    }));

    for (const peg of board.pegs) {
      const body = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(pegR), material: wood });
      body.position.set(peg.x, peg.y, 0);
      world.add(body);
    }
    // Side walls, so a ball that squeezes past the outermost peg comes back.
    for (const sx of [-1, 1]) {
      const wall = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: wood });
      // Face the board, not away from it. A cannon plane's normal is +Z in its
      // own frame, so the right-hand wall turns by -90 degrees and the left by
      // +90; getting this backwards funnels every ball off the same edge.
      wall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), sx > 0 ? -Math.PI / 2 : Math.PI / 2);
      // Flush with the outermost pegs, which is where a real board's frame is.
      wall.position.set(sx * (board.wallX + pegR * 0.9), 0, 0);
      world.add(wall);
    }

    const ball = new CANNON.Body({
      mass: 1, shape: new CANNON.Sphere(ballR), material: rubber,
      linearDamping: 0.02, angularDamping: 0.2,
    });
    ball.position.set(rng.float(-0.42, 0.42) * board.pitch, board.pitch * 2.6, 0);
    ball.velocity.set(rng.float(-0.40, 0.40) + bias, 0, 0);
    world.add(ball);

    const p = [];
    let time = 0, since = RECORD;
    while (time < 6) {
      world.step(STEP);
      // The board is a plane. Nudging z back to zero every step is cheaper and
      // steadier than a constraint, and the ball has no business leaving it.
      ball.position.z = 0; ball.velocity.z = 0;
      time += STEP;
      since += STEP;
      if (since >= RECORD) {
        since -= RECORD;
        p.push(ball.position.x, ball.position.y);
      }
      if (ball.position.y < board.bottom) break;
    }

    // Mirror half of all drops.
    //
    // A physical plinko board is symmetric, but a sequential-impulse solver is
    // not: it resolves contacts in a fixed order, so a ball landing dead centre
    // on a peg is nudged the same way every time and the measured distribution
    // comes out lopsided -- three quarters of the first board's drops finished
    // on the left. Flipping the recorded run about the centre line half the
    // time cancels that exactly, and it is not a thumb on the scale: the flip
    // is chosen before the drop is scored and applies to the trajectory the
    // player watches as well as to the slot it lands in.
    const flip = rng.next() < 0.5;
    if (flip) for (let i = 0; i < p.length; i += 2) p[i] = -p[i];

    const x = flip ? -ball.position.x : ball.position.x;
    let slot = Math.floor(x / board.pitch + board.half);
    slot = Math.max(0, Math.min(board.slots - 1, slot));
    return { p, slot, frames: p.length / 2, flipped: flip };
  }

  function applyPlinko(track, object, seconds) {
    const total = track.p.length / 2;
    const raw = seconds / RECORD;
    const i = Math.min(Math.floor(raw), total - 1);
    const j = Math.min(i + 1, total - 1);
    const t = Math.min(Math.max(raw - i, 0), 1);
    object.position.x = track.p[i * 2] + (track.p[j * 2] - track.p[i * 2]) * t;
    object.position.y = track.p[i * 2 + 1] + (track.p[j * 2 + 1] - track.p[i * 2 + 1]) * t;
    return raw >= total - 1;
  }

  global.GWPhysics.plinkoBoard = plinkoBoard;
  global.GWPhysics.dropPlinko = dropPlinko;
  global.GWPhysics.applyPlinko = applyPlinko;
})(window);
