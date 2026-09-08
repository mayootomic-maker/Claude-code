/* What you can see from where you are standing.

   The darkness is the game. A circle of light around the player is not enough
   on its own -- if it shines through walls you can watch somebody in the next
   room, and the whole map stops mattering. So the lit area is a polygon cast
   against the tile grid: rays out from the player, each stopped by the first
   wall it meets, and the ring of hit points is the shape the renderer punches
   out of the dark.

   Rays march by DDA, one tile boundary at a time, rather than sampling in
   fixed steps. Sampling puts a wobble on every wall as the step size beats
   against the tile size, and at the distances involved that wobble reads as
   the wall itself moving. */

(function (NS) {
  'use strict';

  const T = NS.map.TILE;
  const RAYS = 168;
  const points = new Float32Array(RAYS * 2);

  /* Distance to the first wall along one ray, capped. */
  function cast(ox, oy, dx, dy, maxDist) {
    let tx = Math.floor(ox / T);
    let ty = Math.floor(oy / T);
    if (NS.map.solidTile(tx, ty)) return 0;

    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const deltaX = dx === 0 ? Infinity : Math.abs(T / dx);
    const deltaY = dy === 0 ? Infinity : Math.abs(T / dy);
    let maxX = dx === 0 ? Infinity
      : (dx > 0 ? ((tx + 1) * T - ox) : (ox - tx * T)) / Math.abs(dx);
    let maxY = dy === 0 ? Infinity
      : (dy > 0 ? ((ty + 1) * T - oy) : (oy - ty * T)) / Math.abs(dy);

    let travelled = 0;
    /* The cap is a guard, not a limit: a ray down the west spine crosses
       around fifty tiles and anything longer than the light radius is
       already off the end of the gradient. */
    for (let guard = 0; guard < 220; guard++) {
      if (maxX < maxY) { travelled = maxX; tx += stepX; maxX += deltaX; }
      else { travelled = maxY; ty += stepY; maxY += deltaY; }
      if (travelled >= maxDist) return maxDist;
      if (NS.map.solidTile(tx, ty)) return travelled;
    }
    return maxDist;
  }

  /* The lit polygon around a point, as a flat [x,y,x,y,...] buffer reused
     every frame -- this runs sixty times a second and allocating a fresh
     array of three hundred numbers each time is how a phone gets warm. */
  function visible(ox, oy, radius) {
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      /* Stop a hair short of the wall so the polygon edge sits on the wall
         face rather than a pixel inside it, where it would show a seam. */
      const d = Math.max(0, cast(ox, oy, dx, dy, radius) - 0.5);
      points[i * 2] = ox + dx * d;
      points[i * 2 + 1] = oy + dy * d;
    }
    return points;
  }

  /* Can A see B? Used for who a kill is witnessed by, for whether a ghost
     icon is drawn, and by the bots to decide whether they are alone. Walks
     the segment tile by tile rather than reusing the polygon, because the
     answer has to be exact and the polygon is only as fine as its ray count. */
  function clear(ax, ay, bx, by, maxDist) {
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (maxDist != null && len > maxDist) return false;
    if (len < 1) return true;
    return cast(ax, ay, dx / len, dy / len, len) >= len - 1;
  }

  NS.los = { visible, clear, cast, RAYS };
})(window.NS);
