/* Breaking the station on purpose.

   Sabotage is the impostor's real weapon and the kill is the finish. Its job
   is to move people: a reactor meltdown drags two of them across the map and
   leaves everywhere else empty, lights shrink what the crew can see without
   touching what the impostor can, and doors buy the ten seconds it takes to
   walk out of a room you should not have been in.

   Two of them are critical -- they end the round if they run out. The other
   two have no timer at all, which is what makes them insidious: nobody is
   forced to deal with them, so they get left, and a crew playing in the dark
   with no cameras is a crew that cannot prove anything. */

(function (NS) {
  'use strict';

  const M = NS.map;
  const U = NS.util;
  const SPOTS = M.SABOTAGE_SPOTS;

  const SABOTAGES = {
    reactor: {
      id: 'reactor', name: 'Reactor Meltdown', short: 'Reactor', critical: true, seconds: 45,
      room: 'reactor', fix: 'hold', spots: ['reactorLeft', 'reactorRight'],
      warn: 'Reactor meltdown. Two people, both pads, at the same time.',
      lose: 'The reactor melted down.',
    },
    oxygen: {
      id: 'oxygen', name: 'Oxygen Depleted', short: 'O2', critical: true, seconds: 45,
      room: 'o2', fix: 'code', spots: ['o2Left', 'o2Right'],
      warn: 'Oxygen is venting. Both keypads need the code.',
      lose: 'The station ran out of air.',
    },
    lights: {
      id: 'lights', name: 'Lights Out', short: 'Lights', critical: false, seconds: 0,
      room: 'electrical', fix: 'switches', spots: ['lights'],
      warn: 'The lights are out. The breakers are in Electrical.',
    },
    comms: {
      id: 'comms', name: 'Comms Sabotaged', short: 'Comms', critical: false, seconds: 0,
      room: 'comms', fix: 'tune', spots: ['comms'],
      warn: 'Communications are down. No task list, no cameras, no vitals.',
    },
    doors: {
      id: 'doors', name: 'Doors Sealed', short: 'Doors', critical: false, seconds: 12,
      room: null, fix: null, spots: [],
      warn: 'Doors sealed.',
    },
  };

  /* The order the sabotage menu is drawn in, and the only ones an impostor may
     ask for. Doors are picked by room instead, so they are not in this list. */
  const MENU = ['reactor', 'oxygen', 'lights', 'comms'];

  const REACH = 74;

  /* Which fix point, if any, you are standing at -- for the live sabotage
     only. Standing on the reactor pad when the reactor is fine does nothing,
     and the Use button should not claim otherwise. */
  function fixAt(x, y) {
    const active = NS.world.state.sabotage;
    if (!active) return null;
    const def = SABOTAGES[active.kind];
    if (!def || !def.fix) return null;
    for (let i = 0; i < def.spots.length; i++) {
      if (active.done && active.done[i]) continue;
      const spot = SPOTS[def.spots[i]];
      const w = M.toWorld(spot);
      if (U.dist2(x, y, w.x, w.y) < REACH * REACH) {
        return { kind: active.kind, def, index: i, x: w.x, y: w.y, spot };
      }
    }
    return null;
  }

  /* Every fix point on the map for the live sabotage, so the HUD can point at
     the one you are not standing on. */
  function activeSpots() {
    const active = NS.world.state.sabotage;
    if (!active) return [];
    const def = SABOTAGES[active.kind];
    if (!def) return [];
    return def.spots.map((key, i) => {
      const w = M.toWorld(SPOTS[key]);
      return { x: w.x, y: w.y, index: i, done: !!(active.done && active.done[i]) };
    });
  }

  /* Vision multiplier the lights sabotage applies. Impostors are untouched --
     that asymmetry is the entire point of the sabotage, and a crew that does
     not know about it thinks the impostor got lucky. */
  function visionScale(isImpostor) {
    const active = NS.world.state.sabotage;
    if (!active || active.kind !== 'lights') return 1;
    return isImpostor ? 1 : 0.42;
  }

  const commsDown = () => {
    const a = NS.world.state.sabotage;
    return !!(a && a.kind === 'comms');
  };

  NS.sabotage = { SABOTAGES, MENU, fixAt, activeSpots, visionScale, commsDown, REACH };
})(window.NS);
