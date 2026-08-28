/* The friends, as people standing in the room.

   Until this file existed the game was named after three characters who were a
   list in the sidebar and a line of text in the ticker. You read that Mo had
   dropped four thousand on the roulette; you never saw Mo. Everything here
   exists to close that gap: a body built from the four Blender parts, a walk
   cycle driven by the distance it actually covers, a route to the table it is
   about to bet on, and a reaction when the bet lands.

   The bodies are decoration in the sense that they move no money -- friends.js
   still settles every bet through the same store.resolve the player's hands go
   through. What they are not is a lie: a friend only walks to a table it is
   really about to play, arrives before the money moves, and reacts to the
   result that was actually recorded. The one thing this file adds to the rules
   is that you can now walk up to somebody who is about to do something stupid
   and shout at them in person. */

(function (global) {
  'use strict';

  /* Skin, hair, jacket and trousers are tinted per person, so four friends
     come out of one set of meshes. Height and build are scales on the same
     body: four identical silhouettes across a room is what makes a crowd read
     as clones, and it is cheaper to fix here than with four more models. */
  const LOOK = {
    mo: { skin: 0x8a5a3c, hair: 0x18110e, jacket: 0xd8a13c, trouser: 0x2b2219,
          height: 1.005, build: 1.06 },
    petra: { skin: 0xc9976f, hair: 0x59341d, jacket: 0x3f8f5e, trouser: 0x1d2622,
             height: 0.955, build: 0.93 },
    kez: { skin: 0x7d5539, hair: 0x2a1c30, jacket: 0x4f86c6, trouser: 0x242935,
           height: 0.94, build: 0.99 },
    den: { skin: 0xd2a37e, hair: 0x6b3a24, jacket: 0xc0424e, trouser: 0x261b1b,
           height: 1.05, build: 1.15 },
  };
  const FALLBACK = { skin: 0xb08a68, hair: 0x241a14, jacket: 0x8a8a90,
                     trouser: 0x22232a, height: 1, build: 1 };

  /* Material name in the export -> which slot of the palette tints it. */
  const TINT = {
    crew_skin: 'skin', crew_hair: 'hair', crew_jacket: 'jacket', crew_trouser: 'trouser',
  };

  const WALK = 1.7;             // metres a second, unhurried
  const HURRY = 2.7;            // when they are on their way to do something stupid
  const RADIUS = 0.36;
  const TURN = 7.0;             // radians a second the body turns to face where it is going

  /* Build one body out of the four exported parts.

     Exported separately and assembled here because each part is authored with
     its own joint at the origin: the arm turns about its shoulder because that
     is where its vertices start, not because a rig says so. Both sides use the
     same arm and leg mesh unmirrored -- the parts are symmetric about the body's
     centre plane, and mirroring with a negative scale would reverse the winding
     and turn every limb inside out. */
  function buildBody(lib, look) {
    const J = (lib.doc.meta && lib.doc.meta.person) || {
      hip: 0.92, neck: 0.62, shoulder: 0.555, shoulderX: 0.185, hipX: 0.088,
    };
    const group = new THREE.Group();
    const owned = [];
    const tints = {};

    function part(name) {
      const obj = GWModels.instance(lib, name);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        // The geometry belongs to the model library and the materials are
        // disposed by this module, so the stage's own sweep must leave both
        // alone -- it frees anything in the scene group it is not told about.
        o.userData.shared = true;
        const slot = TINT[o.material.name];
        if (!slot) return;
        if (!tints[slot]) {
          const m = o.material.clone();
          m.color = new THREE.Color(look[slot]);
          tints[slot] = m;
          owned.push(m);
        }
        o.material = tints[slot];
      });
      return obj;
    }

    // One node above the feet carries the bob and the lean, so the walk cycle
    // never has to touch the group the world positions.
    const root = new THREE.Group();
    group.add(root);

    /* The trunk is a pivot with the mesh hung under it, not the mesh itself.
       Build has to widen the chest without widening what is attached to it: an
       earlier version scaled the torso node and took the arms and head with it,
       so the broad friend had a broad head and fat arms and a shoulder joint
       pushed out past his own silhouette. */
    const torso = new THREE.Group();
    torso.position.y = J.hip;
    root.add(torso);
    const trunk = part('person_torso');
    trunk.scale.set(look.build, 1, look.build);
    torso.add(trunk);

    const head = part('person_head');
    head.position.y = J.neck;
    torso.add(head);

    const arms = [];
    for (const side of [-1, 1]) {
      const arm = part('person_arm');
      // Shoulders move out with the build; the arm hanging off them does not.
      arm.position.set(side * J.shoulderX * look.build, J.shoulder, 0);
      // A few degrees out from the body, or the hands swing through the hips.
      arm.rotation.z = side * 0.07;
      torso.add(arm);
      arms.push(arm);
    }

    const legs = [];
    for (const side of [-1, 1]) {
      const leg = part('person_leg');
      leg.position.set(side * J.hipX, J.hip, 0);
      root.add(leg);
      legs.push(leg);
    }

    group.scale.setScalar(look.height);

    return {
      group, root, torso, trunk, head, arms, legs, joints: J,
      dispose() { for (const m of owned) m.dispose(); },
    };
  }

  /* A name that hangs over their head, and a bubble for what they just said.

     Sprites rather than world-space planes: a label you have to walk round to
     read is worse than no label. Depth testing stays on, so somebody behind the
     roulette wheel is behind it. */
  function makeTag(text, colour, opts) {
    const pad = opts.pad || 12;
    const font = opts.font || 30;
    const c = global.document.createElement('canvas');
    const g = c.getContext('2d');
    const lines = wrap(g, text, font, opts.wrap || 22);
    g.font = '600 ' + font + 'px Inter, system-ui, sans-serif';
    let width = 0;
    for (const line of lines) width = Math.max(width, g.measureText(line).width);
    c.width = Math.ceil(width + pad * 2);
    c.height = Math.ceil(lines.length * font * 1.24 + pad * 2);

    const g2 = c.getContext('2d');
    g2.font = '600 ' + font + 'px Inter, system-ui, sans-serif';
    g2.textBaseline = 'top';
    roundRect(g2, 0.5, 0.5, c.width - 1, c.height - 1, 10);
    g2.fillStyle = 'rgba(10,8,9,0.78)';
    g2.fill();
    g2.strokeStyle = colour;
    g2.lineWidth = 2;
    g2.stroke();
    g2.fillStyle = '#f4efe6';
    for (let i = 0; i < lines.length; i++) {
      g2.fillText(lines[i], pad, pad + i * font * 1.24);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false,
    }));
    const scale = (opts.size || 0.34) / (font + pad * 2);
    sprite.scale.set(c.width * scale, c.height * scale, 1);
    sprite.userData.dispose = () => { tex.dispose(); sprite.material.dispose(); };
    return sprite;
  }

  function wrap(g, text, font, columns) {
    g.font = '600 ' + font + 'px Inter, system-ui, sans-serif';
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? line + ' ' + word : word;
      if (next.length > columns && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= 3) return lines;
    // Three lines is all the bubble has room for. Cutting the fourth without
    // saying so leaves a sentence that reads as finished and is not.
    const kept = lines.slice(0, 3);
    kept[2] += '…';
    return kept;
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function create(opts) {
    const { store, level, lib } = opts;
    const onArrive = opts.onArrive || function () {};
    /* Deliberately not the run's seeded RNG.

       Where somebody chooses to loiter is cosmetic, and it happens several
       times a second. Drawing it from store.rng would pour thousands of calls
       into the stream every game outcome is drawn from, so the same seed would
       stop reproducing the same run -- which is the one thing that stream is
       for. */
    const rand = Math.random;
    const people = [];
    const group = new THREE.Group();
    level.group.add(group);

    for (const mate of store.s.friends) {
      const look = Object.assign({}, FALLBACK, LOOK[mate.id] || {});
      let body;
      try {
        body = buildBody(lib, look);
      } catch (err) {
        // A missing person mesh must not take the floor down with it. The
        // friends still bet; you just cannot see them do it.
        console.warn('[gwyf] no body for ' + mate.id, err);
        continue;
      }
      // Small. A label you can read at four metres is a billboard at two, and
      // three of them turn a room into a scoreboard with a casino behind it.
      const tag = makeTag(mate.name, mate.colour, { size: 0.155, font: 30 });
      tag.position.y = body.joints.hip + body.joints.neck + 0.34;
      body.group.add(tag);

      const person = {
        mate, look, body, tag, bubble: null, bubbleLeft: 0,
        pos: new THREE.Vector3(), yaw: 0, wantYaw: 0,
        dest: null, at: null, state: 'idle',
        cycle: 0, blocked: 0, detour: 0, detourSign: 1,
        mood: 0, moodLeft: 0, idleFor: 0, tilting: false, anchor: null,
      };
      spawnAt(person);
      group.add(body.group);
      people.push(person);
    }

    /* Somewhere in the room that is not inside anything. Tried a fixed number
       of times rather than until it works: a floor whose free space this cannot
       find in twenty guesses is a floor where standing in the lift doorway is
       the better failure. */
    function freeSpot(near) {
      const b = level.solids.bounds;
      for (let i = 0; i < 20; i++) {
        const x = b.minX + 1.4 + rand() * (b.maxX - b.minX - 2.8);
        const z = b.minZ + 1.4 + rand() * (b.maxZ - b.minZ - 2.8);
        if (!level.solids.clearAt(x, z, RADIUS + 0.35)) continue;
        if (near && Math.hypot(x - near.x, z - near.z) > 9) continue;
        return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(level.spawn.x, 0, level.spawn.z);
    }

    function spawnAt(person) {
      const spot = freeSpot(null);
      person.pos.copy(spot);
      person.yaw = rand() * Math.PI * 2;
      person.wantYaw = person.yaw;
      person.body.group.position.copy(spot);
      person.body.group.rotation.y = person.yaw;
    }

    const find = (id) => people.find((p) => p.mate.id === id) || null;
    const tagHalf = (person) => person.tag.scale.y / 2;

    /* One pace to the side of where the player stands at a machine, on
       whichever side is clear. */
    function besideStand(anchor) {
      const rot = anchor.rotationY || 0;
      // The machine faces (-sin, -cos); across its face is (-cos, sin).
      const px = -Math.cos(rot), pz = Math.sin(rot);
      for (const side of (rand() < 0.5 ? [0.85, -0.85] : [-0.85, 0.85])) {
        const x = anchor.stand.x + px * side;
        const z = anchor.stand.z + pz * side;
        if (level.solids.clearAt(x, z, RADIUS + 0.1)) return new THREE.Vector3(x, 0, z);
      }
      return anchor.stand.clone();
    }

    /* --- what the day does to them --------------------------------------- */

    /* A friend has decided on a table. If it is on this floor they walk to it;
       if it is upstairs they walk out through the lift and stop being here,
       which is the honest reading of a ticker line about a game you cannot see
       from where you are standing. */
    function go(mateId, gameId, floorIndex) {
      const person = find(mateId);
      if (!person) return;
      // Somebody coming back from another floor arrives through the lift, not
      // by reappearing wherever they were standing when they left.
      if (person.state === 'away') {
        person.pos.set(level.lift.x, 0, level.lift.z);
        person.body.group.position.copy(person.pos);
      }
      let walking = false;
      const anchor = level.anchors.find((a) => a.kind === 'machine' && a.gameId === gameId);
      if (anchor && floorIndex === store.s.floor) {
        walking = true;
        person.at = anchor;
        // Beside the spot the player uses, not on it. Nothing stops a body and
        // a player occupying the same square metre, and standing inside Kez is
        // a worse way to learn that than being asked to step round her.
        person.dest = besideStand(anchor);
        person.state = 'walk';
        // Nobody strolls to a table with a minute of the day left.
        person.hurry = store.s.phase === 'floor' && store.s.timeLeft < 60;
      } else {
        person.at = null;
        person.dest = new THREE.Vector3(level.lift.x, 0, level.lift.z);
        person.state = 'leaving';
      }
      person.blocked = 0;
      person.detour = 0;
      // Whether the bet should now wait for a body to get there. The caller
      // holds the money until it does; if this says no -- the table is on
      // another floor, or there is no room drawn at all -- the bet keeps its
      // own clock.
      return walking;
    }

    function settled(mateId, net) {
      const person = find(mateId);
      if (!person) return;
      person.mood = net > 0 ? 1 : net < 0 ? -1 : 0;
      person.moodLeft = 2.4;
    }

    function speak(mateId, text) {
      const person = find(mateId);
      if (!person) return;
      if (person.bubble) {
        person.body.group.remove(person.bubble);
        person.bubble.userData.dispose();
      }
      const bubble = makeTag(text, person.mate.colour, { size: 0.125, font: 26, wrap: 20 });
      bubble.position.y = person.body.joints.hip + person.body.joints.neck + 0.34
        + tagHalf(person) + 0.05 + bubble.scale.y / 2;
      person.body.group.add(bubble);
      person.bubble = bubble;
      person.bubbleLeft = 3.2 + Math.min(2.4, text.length * 0.045);
    }

    /* About to bet the account. They stop where they are, and an anchor goes in
       so the player can walk over and shout at them in person -- the same shout
       the Q key spends, aimed by standing in front of somebody. */
    function tilt(mateId, on) {
      const person = find(mateId);
      if (!person) return;
      person.tilting = !!on;
      if (on) {
        /* They stop where they are.

           Somebody who has decided to bet the account is not quietly crossing
           the room to do it -- they have turned round to argue about it. It is
           also the only way the anchor is any use: you have a few seconds to
           get to them, and a body still walking at 2.7 m/s cannot be caught. */
        person.dest = null;
        person.at = null;
        person.state = 'idle';
        person.idleFor = 0;
        if (!person.anchor) {
          person.anchor = {
            kind: 'friend',
            mateId: person.mate.id,
            label: 'Shout at ' + person.mate.name,
            // The live vector, not a copy: the interaction test then follows
            // them if anything moves them before you get there.
            position: person.pos,
            half: { hw: 0.42, hd: 0.42 },
          };
          level.anchors.push(person.anchor);
        }
      } else if (person.anchor) {
        const i = level.anchors.indexOf(person.anchor);
        if (i >= 0) level.anchors.splice(i, 1);
        person.anchor = null;
      }
    }

    /* --- the frame --------------------------------------------------------- */

    const toDest = new THREE.Vector3();
    const step = { x: 0, z: 0 };

    function update(dt, playerPos) {
      for (const person of people) {
        stepPerson(person, dt, playerPos);
      }
    }

    function stepPerson(person, dt, playerPos) {
      const body = person.body;

      if (person.bubbleLeft > 0) {
        person.bubbleLeft -= dt;
        if (person.bubbleLeft <= 0 && person.bubble) {
          body.group.remove(person.bubble);
          person.bubble.userData.dispose();
          person.bubble = null;
        }
      }
      if (person.moodLeft > 0) person.moodLeft = Math.max(0, person.moodLeft - dt);

      // Away means away: no body, no label, no walk cycle to run.
      if (person.state === 'away') {
        body.group.visible = false;
        return;
      }
      body.group.visible = true;

      let speed = 0;
      if (person.dest) {
        toDest.set(person.dest.x - person.pos.x, 0, person.dest.z - person.pos.z);
        const dist = toDest.length();
        const arrived = dist < (person.state === 'leaving' ? 0.9 : 0.45);
        if (arrived) {
          person.dest = null;
          if (person.state === 'leaving') { person.state = 'away'; return; }
          const wasWalkingToTable = person.state === 'walk' && person.at;
          person.state = person.at ? 'play' : 'idle';
          person.idleFor = 0;
          // The money moves now, not on a timer that guessed how far this was.
          if (wasWalkingToTable) onArrive(person.mate.id);
        } else {
          toDest.divideScalar(dist);
          let dirX = toDest.x, dirZ = toDest.z;
          // Steer round whatever is in the way. Without this a friend heading
          // for the far wall walks into the side of the dice table and stays
          // there, treading the carpet, for the rest of the day.
          if (person.detour > 0) {
            person.detour -= dt;
            dirX = toDest.x + -toDest.z * person.detourSign * 1.5;
            dirZ = toDest.z + toDest.x * person.detourSign * 1.5;
            const len = Math.hypot(dirX, dirZ) || 1;
            dirX /= len; dirZ /= len;
          }
          speed = (person.tilting || person.hurry) ? HURRY : WALK;
          step.x = person.pos.x + dirX * speed * dt;
          step.z = person.pos.z + dirZ * speed * dt;
          level.solids.resolve(step, RADIUS);
          level.solids.bound(step, RADIUS);
          const moved = Math.hypot(step.x - person.pos.x, step.z - person.pos.z);
          person.pos.x = step.x;
          person.pos.z = step.z;
          if (moved < speed * dt * 0.4) {
            person.blocked += dt;
            if (person.blocked > 0.35 && person.detour <= 0) {
              person.detour = 1.4;
              person.detourSign = rand() < 0.5 ? 1 : -1;
            }
          } else {
            person.blocked = Math.max(0, person.blocked - dt);
          }
          person.wantYaw = Math.atan2(-dirX, -dirZ);
          person.cycle += (moved / dt) * dt * 2.6;
        }
      } else if (person.state === 'play' && person.at) {
        // Stand at the table facing it.
        const focus = person.at.focus || person.at.position;
        person.wantYaw = Math.atan2(-(focus.x - person.pos.x), -(focus.z - person.pos.z));
      } else {
        person.idleFor += dt;
        // Loiter. Standing perfectly still for five minutes is what makes a
        // character read as a prop.
        if (person.idleFor > 6 + rand() * 8) {
          person.idleFor = 0;
          person.dest = freeSpot(person.pos);
          person.state = 'idle';
        } else if (playerPos && person.idleFor > 0.4) {
          // Look at whoever walks past.
          const d = Math.hypot(playerPos.x - person.pos.x, playerPos.z - person.pos.z);
          if (d < 4.5) {
            person.wantYaw = Math.atan2(-(playerPos.x - person.pos.x),
                                        -(playerPos.z - person.pos.z));
          }
        }
      }

      // Turn towards where they are going, the short way round.
      let delta = person.wantYaw - person.yaw;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      person.yaw += delta * Math.min(1, TURN * dt);
      body.group.position.set(person.pos.x, 0, person.pos.z);
      body.group.rotation.y = person.yaw;

      pose(person, dt, speed);
    }

    /* The walk cycle, and everything that is not one.

       Driven by the distance covered rather than by time, so a friend squeezing
       past a pillar at half speed takes half-length steps instead of moon
       walking. */
    function pose(person, dt, speed) {
      const body = person.body;
      const moving = speed > 0.05;
      const swing = moving ? Math.min(0.62, speed * 0.30) : 0;
      const s = Math.sin(person.cycle);
      const c = Math.cos(person.cycle);

      body.legs[0].rotation.x = s * swing;
      body.legs[1].rotation.x = -s * swing;
      body.root.position.y = moving ? Math.abs(c) * 0.028 : 0;
      body.root.rotation.z = moving ? -s * 0.02 : 0;

      let armSwing = -s * swing * 0.8;
      let reach = 0, lean = 0, headTilt = 0;

      if (person.state === 'play' && !moving) {
        // Leaning in over the table with a hand out on it.
        lean = 0.14;
        reach = -0.95 + Math.sin(person.cycle * 0.7) * 0.05;
        person.cycle += dt * 1.4;
      } else if (!moving) {
        // Breathing, and a slow shift of weight.
        person.cycle += dt * 1.1;
        armSwing = Math.sin(person.cycle) * 0.02;
        body.root.rotation.z = Math.sin(person.cycle * 0.5) * 0.012;
      }

      if (person.moodLeft > 0) {
        const k = Math.min(1, person.moodLeft / 2.4);
        if (person.mood > 0) {
          // Arms up. Nobody wins quietly.
          armSwing = -2.3 * k + Math.sin(person.cycle * 6) * 0.18 * k;
          body.root.position.y += Math.abs(Math.sin(person.cycle * 5)) * 0.06 * k;
          reach = 0;
          headTilt = -0.18 * k;
        } else if (person.mood < 0) {
          lean += 0.22 * k;
          headTilt = 0.34 * k;
          armSwing = 0.10 * k;
          reach = 0;
        }
      }

      if (person.tilting) {
        // Wound up: shoulders forward, and a shake nobody can miss across a
        // room, because a few seconds is all you get to notice it.
        person.cycle += dt * 2.0;
        lean += 0.10;
        armSwing = -0.55 + Math.sin(person.cycle * 9) * 0.09;
        headTilt = -0.08;
      }

      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const arm = body.arms[i];
        arm.rotation.x = (reach ? reach : armSwing * (i === 0 ? 1 : -1));
        arm.rotation.z = side * 0.07;
      }
      body.torso.rotation.x = lean;
      body.head.rotation.x = headTilt;
    }

    function dispose() {
      for (const person of people) {
        if (person.anchor) tilt(person.mate.id, false);
        if (person.bubble) person.bubble.userData.dispose();
        person.tag.userData.dispose();
        person.body.dispose();
      }
      people.length = 0;
      if (group.parent) group.parent.remove(group);
    }

    return {
      people, update, go, settled, speak, tilt, dispose, group,
      /* What somebody is doing, for the crew rail. The rail used to read the
         game they had picked, which after a bet was announced but before they
         got there said "Roulette" about somebody standing by the lift. */
      stateOf(id) { const p = find(id); return p ? p.state : null; },
    };
  }

  global.GWCrew = { create, buildBody, LOOK };
})(window);
