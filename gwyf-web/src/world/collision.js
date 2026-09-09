/* Collision for a person walking around a room.

   Everything solid in the casino is a box: walls, pillars, the lift shaft, the
   machines themselves. A player is a circle. So the whole problem is
   circle-versus-box, resolved by pushing the circle out along the shallowest
   axis, which is stable, cheap, and slides along walls instead of catching on
   them the way a naive "stop when blocked" test does.

   Two passes per move. One pass leaves you stuck in the corner where two walls
   meet: resolving against the first wall pushes you into the second. */

(function (global) {
  'use strict';

  function World() {
    this.boxes = [];
  }

  /* A solid box, centred on (x, z), extending hw and hd. `tag` is carried back
     out by `probe` so callers can tell a machine from a wall.

     `top` is how tall it is, and leaving it out means "as tall as the room" --
     which is what every box in this world used to be, whether it was a wall or
     a shin-high crate. The floor was a single plane at zero and nothing had a
     surface, so the run of crates in the yard could be walked into and never
     stood on: measured, six run-ups and jumps at the lowest one left the
     player at y = 0, five metres further back than they started, and the
     ticket on top of the last one was unreachable by playing. Every harness
     passed, because they all set the player's height by hand. */
  World.prototype.add = function (x, z, hw, hd, tag, top) {
    this.boxes.push({
      x, z, hw, hd, tag: tag || null,
      top: (top === undefined || top === null) ? Infinity : top,
    });
    return this;
  };

  /* Add a wall from one point to another with a given thickness. Walls are
     axis-aligned here; a diagonal one gets the axis-aligned box that contains
     it, which is close enough for a room made of rectangles. */
  World.prototype.wall = function (x1, z1, x2, z2, thickness, tag) {
    const t = (thickness || 0.3) / 2;
    return this.add(
      (x1 + x2) / 2, (z1 + z2) / 2,
      Math.abs(x2 - x1) / 2 + t, Math.abs(z2 - z1) / 2 + t, tag || 'wall'
    );
  };

  World.prototype.clear = function () { this.boxes.length = 0; };

  /* Push a circle out of everything it overlaps. Mutates `p` (an object with x
     and z) and returns true if it moved.

     `feet` is how high off the floor the circle is and `step` how big a lip it
     can walk up without jumping. Anything whose top is at or below feet + step
     is not in the way: you are above it, or about to be. Both default to zero,
     which is the old behaviour -- everything solid, nothing climbable -- and
     is what the crowd still uses, because a stranger who can climb the freight
     is a stranger on the roof. */
  World.prototype.resolve = function (p, radius, feet, step) {
    const clears = (feet || 0) + (step || 0) + 1e-4;
    let moved = false;
    for (let pass = 0; pass < 2; pass++) {
      for (const b of this.boxes) {
        if (b.top <= clears) continue;
        const dx = p.x - b.x;
        const dz = p.z - b.z;
        const px = b.hw + radius - Math.abs(dx);
        if (px <= 0) continue;
        const pz = b.hd + radius - Math.abs(dz);
        if (pz <= 0) continue;
        // Overlapping on both axes: back out along whichever is shallower, so
        // walking into a wall slides along it rather than stopping dead.
        if (px < pz) p.x += dx < 0 ? -px : px;
        else p.z += dz < 0 ? -pz : pz;
        moved = true;
      }
    }
    return moved;
  };

  /* A hard boundary, applied after the boxes.

     The box solver pushes a circle out of the nearest face, which is right when
     you are inside the room and wrong if you ever end up outside one -- it
     helpfully pushes you further out. Walls are continuous so that should not
     happen, but "should not happen" is how people end up walking around in the
     void behind a casino, so the room's own extent is enforced as well. */
  World.prototype.bound = function (p, radius) {
    if (!this.bounds) return;
    const b = this.bounds;
    p.x = Math.max(b.minX + radius, Math.min(b.maxX - radius, p.x));
    p.z = Math.max(b.minZ + radius, Math.min(b.maxZ - radius, p.z));
  };

  World.prototype.setBounds = function (minX, minZ, maxX, maxZ) {
    this.bounds = { minX, minZ, maxX, maxZ };
    return this;
  };

  /* The surface under a circle: the top of the highest box it is standing over
     that is not above its head.

     `ceiling` is as high as a surface may be and still count as something you
     could be on -- the feet plus the step height while walking, or the feet
     alone while falling, so a jump lands on a crate rather than snapping to
     the top of the wall behind it. Nothing under it is the floor, at zero. */
  World.prototype.groundAt = function (x, z, radius, ceiling) {
    let best = 0;
    const lip = ceiling === undefined ? Infinity : ceiling;
    for (const b of this.boxes) {
      if (b.top === Infinity || b.top <= best || b.top > lip) continue;
      /* Supported while most of your feet are on it.

         Measured to the box's own edge, a gap of a few centimetres between two
         crates is a hole you fall down: at the middle of it you are over
         neither, and the climb ends. Measured to a full circle round you, you
         hover a third of a metre past every edge. Most of the circle is the
         answer both ways. */
      if (Math.abs(x - b.x) > b.hw + radius * 0.8) continue;
      if (Math.abs(z - b.z) > b.hd + radius * 0.8) continue;
      best = b.top;
    }
    return best;
  };

  /* Does this axis-aligned box touch anything already here?

     `clearAt` asks the same question of a circle, which is the right shape for
     a person and the wrong one for a five-metre dice table: a circle big
     enough to contain the table rejects half the room, and one small enough to
     fit inside it misses the bench at the corner. */
  World.prototype.overlaps = function (x, z, hw, hd) {
    for (const b of this.boxes) {
      if (Math.abs(x - b.x) < b.hw + hw && Math.abs(z - b.z) < b.hd + hd) return true;
    }
    return false;
  };

  /* Is this circle clear of everything? Used to place things without burying
     them in a wall. */
  World.prototype.clearAt = function (x, z, radius) {
    for (const b of this.boxes) {
      if (Math.abs(x - b.x) < b.hw + radius && Math.abs(z - b.z) < b.hd + radius) return false;
    }
    return true;
  };

  global.GWCollision = { World };
})(window);
