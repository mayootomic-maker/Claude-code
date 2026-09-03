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
    mo: { body: 0xf2c14e, hat: 'pin_hat_fez', height: 1.02, width: 1.05 },
    petra: { body: 0x6fcf97, hat: 'pin_monocle', height: 0.95, width: 0.93 },
    kez: { body: 0x7fb3ec, hat: 'pin_hat_boater', height: 0.92, width: 1.00 },
    den: { body: 0xef6f79, hat: 'pin_hat_top', height: 1.06, width: 1.12 },
  };
  const FALLBACK = { body: 0xc9a9d4, hat: null, height: 1, width: 1 };

  /* The body is one flat colour, so there is exactly one material to tint --
     which is the point of the design. Eyes, brow, mouth and hats are shared. */
  const TINT = { pin_body: 'body' };

  const WALK = 1.7;             // metres a second, unhurried
  const HURRY = 2.7;            // when they are on their way to do something stupid
  const RADIUS = 0.36;
  const TURN = 7.0;             // radians a second the body turns to face where it is going

  /* Build one body out of its parts.

     A pin, a head, and two hands that are not attached to anything -- there are
     no arms and no legs to attach them to. The hands float beside the body and
     are driven directly, which is why they hang off the root rather than off a
     shoulder: in this design there is no shoulder. */
  function buildBody(lib, look) {
    const J = (lib.doc.meta && lib.doc.meta.pin) || {
      height: 1.52, neck: 0.905, hand: 0.560, handX: 0.335, brow: 1.265,
    };
    const group = new THREE.Group();
    const owned = [];
    let skin = null;

    function part(name) {
      const obj = GWModels.instance(lib, name);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        // The geometry belongs to the model library and the materials are
        // disposed by this module, so the stage's own sweep must leave both
        // alone -- it frees anything in the scene group it is not told about.
        o.userData.shared = true;
        if (!TINT[o.material.name]) return;
        if (!skin) {
          skin = o.material.clone();
          skin.color = new THREE.Color(look.body);
          owned.push(skin);
        }
        o.material = skin;
      });
      return obj;
    }

    // One node above the floor carries the bob and the lean, so the waddle
    // never has to touch the group the world positions.
    const root = new THREE.Group();
    group.add(root);

    const trunk = part('pin_body');
    trunk.scale.set(look.width, 1, look.width);
    root.add(trunk);

    // The head is its own node so it can turn and tilt on the neck.
    const head = new THREE.Group();
    head.position.y = J.neck;
    root.add(head);
    head.add(part('pin_head'));

    /* The brow, on its own node.

       Half the expression lives here. This face is two enormous eyes and one
       heavy bar above them, so with the bar welded to the skull the only thing
       a character can do is turn round. Loose, it blinks, scowls and raises,
       and all three read from the far side of a room. */
    const brow = part('pin_brow');
    const at = J.browAt || [0, 0.35, -0.182];
    brow.position.set(at[0], at[1], at[2]);
    head.add(brow);

    if (look.hat) {
      const hat = part(look.hat);
      // A monocle hangs on the face; a hat sits on the crown.
      /* A monocle hangs on the face; a hat sits on the crown.

         The face is at -Z: models are authored facing Blender's +Y and the
         export turns that into three.js's -Z, so a monocle at +Z hangs off the
         back of the head. The ring is also authored flat and stood up here --
         rotating it in Blender means reasoning about two chained rotations
         through the Y-up rig, which produced a halo round the head twice. */
      if (look.hat === 'pin_monocle') {
        hat.position.set(-0.120, 0.262, -0.232);
        hat.rotation.x = Math.PI / 2;
      } else {
        hat.position.y = 0.395;
      }
      head.add(hat);
    }

    const hands = [];
    for (const side of [-1, 1]) {
      const hand = part('pin_hand');
      hand.position.set(side * J.handX * look.width, J.hand, 0.06);
      // The mitten is modelled once and used on both sides. It is symmetric
      // about the body's centre plane, so it needs turning rather than
      // mirroring -- a negative scale would reverse the winding and turn it
      // inside out.
      hand.rotation.y = side < 0 ? Math.PI : 0;
      root.add(hand);
      hands.push(hand);
    }

    group.scale.setScalar(look.height);

    return {
      group, root, trunk, head, brow, hands, joints: J,
      browHome: brow.position.clone(),
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
      tag.position.y = body.joints.height * 0.98;
      body.group.add(tag);

      const person = {
        mate, look, body, tag, bubble: null, bubbleLeft: 0,
        pos: new THREE.Vector3(), yaw: 0, wantYaw: 0,
        dest: null, at: null, state: 'idle',
        cycle: 0, blocked: 0, detour: 0, detourSign: 1,
        mood: 0, moodLeft: 0, idleFor: 0, tilting: false, offering: false, anchor: null,
        lookAtPlayer: 0,
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
      bubble.position.y = person.body.joints.height * 0.98
        + tagHalf(person) + 0.05 + bubble.scale.y / 2;
      person.body.group.add(bubble);
      person.bubble = bubble;
      person.bubbleLeft = 3.2 + Math.min(2.4, text.length * 0.045);
    }

    /* Somebody is up and waving you over.

       Same mechanism as the tilt: an anchor goes in so they can be walked up
       to. The difference is what pressing E does, which the shell decides --
       this only makes them approachable and marks them so they read as wanting
       something from across the room. */
    function offer(mateId) {
      for (const person of people) {
        const wants = person.mate.id === mateId;
        if (person.offering === wants) continue;
        person.offering = wants;
        if (wants) {
          person.dest = null;
          person.at = null;
          person.state = 'idle';
          mark(person, 'Take ' + person.mate.name + '\u2019s half');
        } else if (!person.tilting) {
          unmark(person);
        }
      }
    }

    /* Put an anchor on somebody so the interaction test can find them. The live
       position vector goes in rather than a copy, so it follows them. */
    function mark(person, label) {
      if (person.anchor) {
        person.anchor.label = label;
        return;
      }
      person.anchor = {
        kind: 'friend',
        mateId: person.mate.id,
        label,
        position: person.pos,
        half: { hw: 0.42, hd: 0.42 },
      };
      level.anchors.push(person.anchor);
    }

    function unmark(person) {
      if (!person.anchor) return;
      const i = level.anchors.indexOf(person.anchor);
      if (i >= 0) level.anchors.splice(i, 1);
      person.anchor = null;
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
        mark(person, 'Shout at ' + person.mate.name);
      } else if (person.anchor && !person.offering) {
        unmark(person);
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
        }
      }

      /* Look at whoever walks past -- with the head, not the whole body.

         Turning the body to face you is what a shop mannequin on a turntable
         does; turning just the head, and only as far as a neck goes, is what a
         person does. Past that the body comes round with it. */
      person.lookAtPlayer = 0;
      if (playerPos) {
        const dx = playerPos.x - person.pos.x;
        const dz = playerPos.z - person.pos.z;
        if (Math.hypot(dx, dz) < 5.0) {
          let off = Math.atan2(-dx, -dz) - person.yaw;
          while (off > Math.PI) off -= Math.PI * 2;
          while (off < -Math.PI) off += Math.PI * 2;
          if (Math.abs(off) < 1.9) {
            person.lookAtPlayer = Math.max(-0.85, Math.min(0.85, off));
          } else if (!person.dest) {
            // Behind them: they turn round rather than crane over a shoulder.
            person.wantYaw = Math.atan2(-dx, -dz);
          }
        }
      }

      /* Step out of the player's way.

         The bodies are not in the collision world -- putting them there risks
         wedging the player into a corner behind one -- so instead they push
         themselves out of the player's space. Standing inside somebody is very
         visible now that they are a metre and a half of solid colour. */
      if (playerPos) {
        const gx = person.pos.x - playerPos.x;
        const gz = person.pos.z - playerPos.z;
        const gap = Math.hypot(gx, gz);
        const want = RADIUS + 0.42;
        if (gap < want && gap > 1e-4) {
          const push = (want - gap) * Math.min(1, dt * 9);
          person.pos.x += (gx / gap) * push;
          person.pos.z += (gz / gap) * push;
          level.solids.resolve(person.pos, RADIUS);
          level.solids.bound(person.pos, RADIUS);
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

    /* --- animation ---------------------------------------------------------

       Rebuilt, because the first version was a sine wave written straight onto
       the body every frame and it showed: nothing had weight, nothing lagged
       anything else, and changing state was a snap between two poses with
       nothing in between.

       What is here instead:

       - **Blend weights.** Every state -- idle, walking, playing, won, lost,
         tilting -- has a weight that eases to nought or one. The pose is the
         sum of all six, so a friend who wins while walking raises their hands
         without stopping dead first.
       - **Springs, not lerps.** Lean, hand height, head turn and squash are
         driven towards a target by a spring with real damping, so they
         overshoot slightly and settle. That overshoot is the whole difference
         between a puppet and a body.
       - **Squash and stretch.** The one thing a legless pin has instead of a
         skeleton. It stretches at the top of a step and squashes on the
         contact, and the volume is kept -- widening as it shortens -- so it
         reads as a body rather than as a scaling bug.
       - **Follow-through.** The hands chase the body rather than being placed
         on it, so they trail on a turn and swing past on a stop.
       - **Blinking.** The face is two enormous eyes; not blinking is the most
         obviously wrong thing a face like that can do. The brow drops over
         them, at human intervals, twice in quick succession now and then. */

    const STATE_BLEND = 7.0;      // how fast a state's weight comes and goes

    function spring(s_, target, stiffness, damping, dt) {
      const a = (target - s_.v) * stiffness - s_.d * damping;
      s_.d += a * dt;
      s_.v += s_.d * dt;
      return s_.v;
    }

    function newRig() {
      const s_ = () => ({ v: 0, d: 0 });
      return {
        lean: s_(), roll: s_(), rise: s_(), squash: s_(),
        headTurn: s_(), headTilt: s_(), browTilt: s_(), browDrop: s_(),
        handLift: s_(), handOut: s_(), handSwing: s_(),
        bank: s_(),
        weights: { idle: 1, walk: 0, run: 0, play: 0, won: 0, lost: 0, tilt: 0 },
        step: 0, blink: 2 + rand() * 3, blinking: 0, doubleBlink: false,
        glance: 3 + rand() * 5, glanceTo: 0,
        lastYaw: null, turn: 0,
      };
    }

    function pose(person, dt, speed) {
      const body = person.body;
      const J = body.joints;
      const rig = person.rig || (person.rig = newRig());
      const moving = speed > 0.05;

      /* --- which state, and how much of it ---------------------------------- */
      /* Walking and running are different gaits, not one gait at two speeds.

         `walk` used to saturate at 1.7 m/s, so a body crossing the floor at
         five looked exactly like one ambling at two -- the single clearest
         reason the crew read as sliding rather than moving. Above walking pace
         the run weight takes over: further forward, longer in the stride,
         more air in it. */
      const RUNS_AT = 3.4;
      const runAmount = Math.min(1, Math.max(0, (speed - 2.1) / (RUNS_AT - 2.1)));
      const want = {
        idle: !moving && person.state !== 'play' ? 1 : 0,
        walk: moving ? Math.min(1, speed / 1.7) * (1 - runAmount) : 0,
        run: moving ? runAmount : 0,
        play: person.state === 'play' && !moving ? 1 : 0,
        won: person.mood > 0 && person.moodLeft > 0 ? 1 : 0,
        lost: person.mood < 0 && person.moodLeft > 0 ? 1 : 0,
        tilt: person.tilting ? 1 : 0,
      };
      const w = rig.weights;
      const k = Math.min(1, STATE_BLEND * dt);
      for (const key in want) w[key] += (want[key] - w[key]) * k;

      /* --- the step ---------------------------------------------------------
         Driven by distance covered, so somebody squeezing past a pillar at half
         speed takes half-length steps instead of moon walking. Two beats per
         cycle: a pin has no legs, so the "step" is the body dropping onto one
         side and pushing off again. */
      rig.step += (moving ? speed * 2.1 : 1.3) * dt;

      /* How hard they are turning, for the bank.

         A body that changes direction leans into it. Without this a friend
         rounding a pillar pivots like a chess piece, which is the other half
         of why they read as sliding. The rate is smoothed because a heading
         taken from a steering solver is noisy frame to frame. */
      if (rig.lastYaw === null) rig.lastYaw = person.yaw;
      let dYaw = person.yaw - rig.lastYaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      rig.lastYaw = person.yaw;
      const rate = dt > 0.0001 ? dYaw / dt : 0;
      rig.turn += (Math.max(-3, Math.min(3, rate)) - rig.turn) * Math.min(1, 8 * dt);
      const beat = Math.sin(rig.step);
      const bounce = Math.abs(Math.cos(rig.step));
      // Impact rises towards 1 at the bottom of each beat: the contact.
      const impact = Math.pow(Math.max(0, -Math.cos(rig.step * 2)), 2);

      /* --- targets, summed across the states -------------------------------- */
      let lean = 0, roll = 0, rise = 0, squash = 0, bank = 0;
      let headTurn = 0, headTilt = 0, browTilt = 0, browDrop = 0;
      let handLift = 0, handOut = 0, handSwing = 0;

      // Walking: lean into it, roll onto each side, rise and fall, squash on
      // the contact, hands swinging against the roll.
      lean += w.walk * 0.20;
      roll += w.walk * beat * 0.13;
      rise += w.walk * bounce * 0.045;
      squash -= w.walk * impact * 0.09;
      handSwing += w.walk * -beat * 0.26;
      handLift += w.walk * bounce * 0.03;

      // Running: further over the front foot, more air, arms driving rather
      // than swinging, and the whole body squashing harder on each contact.
      lean += w.run * 0.46;
      roll += w.run * beat * 0.17;
      rise += w.run * bounce * 0.105;
      squash -= w.run * impact * 0.16;
      handSwing += w.run * -beat * 0.52;
      handLift += w.run * (0.10 + bounce * 0.07);
      handOut += w.run * 0.05;
      headTilt -= w.run * 0.06;      // chin up, looking where they are going

      // Banking into a turn, for anyone actually moving. Leaning the wrong way
      // out of a corner looks worse than not leaning at all, so it is signed
      // off the turn rate and scaled by how fast they are going.
      bank -= rig.turn * 0.16 * Math.min(1, speed / 2.2) * (w.walk + w.run);

      // Idle: breathing, a slow shift of weight, and looking about.
      squash += w.idle * Math.sin(rig.step * 0.62) * 0.022;
      roll += w.idle * Math.sin(rig.step * 0.31) * 0.03;
      headTurn += w.idle * rig.glanceTo;

      // At a table: leaning in with both hands on the felt.
      lean += w.play * 0.22;
      handOut += w.play * 0.16;
      handLift += w.play * -0.13;
      headTilt += w.play * 0.10;

      // Won: hands up, brows up, and a hop. Nobody wins quietly.
      handLift += w.won * (0.52 + Math.abs(Math.sin(rig.step * 3.1)) * 0.12);
      handOut += w.won * 0.10;
      rise += w.won * Math.abs(Math.sin(rig.step * 3.1)) * 0.13;
      squash += w.won * Math.abs(Math.sin(rig.step * 3.1)) * 0.07;
      headTilt -= w.won * 0.22;
      browTilt -= w.won * 0.5;
      lean -= w.won * 0.10;

      // Lost: everything drops.
      lean += w.lost * 0.24;
      headTilt += w.lost * 0.28;
      handLift -= w.lost * 0.13;
      squash -= w.lost * 0.06;
      browTilt += w.lost * 0.6;

      // Tilting: wound up, shaking, brows down. A few seconds is all you get to
      // notice it, so it is the loudest thing in the set.
      lean += w.tilt * 0.16;
      roll += w.tilt * Math.sin(rig.step * 9) * 0.06;
      handLift += w.tilt * (0.18 + Math.sin(rig.step * 11) * 0.05);
      handOut += w.tilt * 0.14;
      browTilt += w.tilt * 0.85;

      // Looking at whoever walked up beats looking around the room.
      if (person.lookAtPlayer) headTurn = person.lookAtPlayer;

      /* --- blinking ---------------------------------------------------------- */
      rig.blink -= dt;
      if (rig.blink <= 0) {
        rig.blinking = 0.13;
        // People blink twice in quick succession often enough that always
        // blinking singly is its own kind of uncanny.
        rig.blink = rig.doubleBlink ? 2.4 + rand() * 4 : (rand() < 0.3 ? 0.22 : 2.4 + rand() * 4);
        rig.doubleBlink = rig.blink < 0.5;
      }
      if (rig.blinking > 0) { rig.blinking -= dt; browDrop = 1; }

      // Idle glancing: a new place to look every few seconds.
      rig.glance -= dt;
      if (rig.glance <= 0) {
        rig.glance = 2.5 + rand() * 5;
        rig.glanceTo = (rand() - 0.5) * 1.1;
      }

      /* --- springs ----------------------------------------------------------- */
      const leanV = spring(rig.lean, lean, 180, 22, dt);
      const rollV = spring(rig.roll, roll, 210, 24, dt) + spring(rig.bank, bank, 70, 14, dt);
      const riseV = spring(rig.rise, rise, 260, 26, dt);
      const squashV = spring(rig.squash, squash, 240, 24, dt);
      const headTurnV = spring(rig.headTurn, headTurn, 90, 17, dt);
      const headTiltV = spring(rig.headTilt, headTilt, 110, 18, dt);
      const browTiltV = spring(rig.browTilt, browTilt, 150, 20, dt);
      const browDropV = spring(rig.browDrop, browDrop, 900, 46, dt);
      // The hands are deliberately floppier than everything else: a lower
      // stiffness is what makes them trail the body instead of riding it.
      const handLiftV = spring(rig.handLift, handLift, 95, 15, dt);
      const handOutV = spring(rig.handOut, handOut, 95, 15, dt);
      const handSwingV = spring(rig.handSwing, handSwing, 130, 16, dt);

      /* --- write it out ------------------------------------------------------ */
      body.root.position.y = riseV;
      body.root.rotation.z = rollV;
      /* Negated on the way out, so that everything above can read as "lean
         forward by this much".

         The models face -Z, so a positive rotation about X tips the top of the
         body towards +Z -- backwards. Written straight through, every lean in
         the set was pointing the wrong way: the walk leaned away from the
         direction of travel and the slump after a loss was a proud recline. */
      body.root.rotation.x = -leanV;
      // Volume is kept: shorter is wider. Scaling one axis alone reads as a
      // bug rather than as weight.
      const sy = 1 + squashV;
      const sxz = 1 - squashV * 0.55;
      body.trunk.scale.set(person.look.width * sxz, sy, person.look.width * sxz);
      // The head rides the top of the body, so it has to move with the squash
      // or it detaches at the neck.
      body.head.position.y = J.neck * sy;
      body.head.rotation.y = headTurnV;
      body.head.rotation.x = -headTiltV;   // same convention: positive is a nod

      // Positive browTilt is a scowl, so the inner ends come down.
      body.brow.rotation.x = -browTiltV * 0.42;
      body.brow.position.y = body.browHome.y - browDropV * 0.085;
      body.brow.position.z = body.browHome.z - browDropV * 0.012;

      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const swing = i === 0 ? handSwingV : -handSwingV;
        body.hands[i].position.set(
          side * (J.handX * person.look.width + handOutV),
          (J.hand + handLiftV) * sy + swing * 0.14,
          0.06 + swing
        );
        body.hands[i].rotation.z = side * (0.10 + handLiftV * 0.5);
        body.hands[i].rotation.x = -swing * 0.6;
        body.hands[i].rotation.y = side < 0 ? Math.PI : 0;
      }
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
      people, update, go, settled, speak, tilt, offer, dispose, group,
      /* What somebody is doing, for the crew rail. The rail used to read the
         game they had picked, which after a bet was announced but before they
         got there said "Roulette" about somebody standing by the lift. */
      stateOf(id) { const p = find(id); return p ? p.state : null; },
    };
  }

  /* The player's own hands.

     In the game this follows your two mitten hands sit in the bottom corners of
     the screen in very nearly every frame, tinted your own colour, and their
     absence is one of the loudest things missing from a port of it. They are
     the same mesh the friends use, parented to the camera, and they bob with
     the walk and dip on a landing -- which is also the cheapest way to make a
     first-person camera feel like it belongs to a body. */
  const YOU = { body: 0xd9a441 };

  function buildHands(lib, colour, camera) {
    const group = new THREE.Group();
    const owned = [];
    let skin = null;
    const hands = [];
    for (const side of [-1, 1]) {
      const hand = GWModels.instance(lib, 'pin_hand');
      hand.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.shared = true;
        // These are drawn a few centimetres from the lens; a shadow cast from
        // there lands across the whole room.
        o.castShadow = false;
        o.receiveShadow = false;
        if (!TINT[o.material.name]) return;
        if (!skin) {
          skin = o.material.clone();
          skin.color = new THREE.Color(colour === undefined ? YOU.body : colour);
          owned.push(skin);
        }
        o.material = skin;
      });
      hand.rotation.y = side < 0 ? Math.PI : 0;
      group.add(hand);
      hands.push(hand);
    }
    group.renderOrder = 10;
    return {
      group, hands,
      /* Place them for this frame. `bob` is the walk phase, `speed` how fast,
         `fall` the vertical velocity so they drop when you do. */
      update(bob, speed, fall, crouch) {
        // Half the visible frame at the distance the hands are held, from the
        // camera's live field of view rather than a number written down once.
        const Z = -0.52;
        const halfH = Math.abs(Z) * Math.tan((camera.fov * Math.PI / 180) / 2);
        const halfW = halfH * camera.aspect;
        const sway = Math.sin(bob) * Math.min(0.035, speed * 0.012);
        const lift = Math.abs(Math.cos(bob)) * Math.min(0.03, speed * 0.010);
        const drop = Math.max(-0.10, Math.min(0.10, -fall * 0.016));
        for (let i = 0; i < 2; i++) {
          const side = i === 0 ? -1 : 1;
          /* Placed as a fraction of the frame, not in metres.

             Hard-coded offsets only ever suit one lens. These were measured
             against a 38-degree field of view; the moment walking got its own
             wide one they stopped hugging the lower corners and floated into
             the middle of the screen like two loaves. Deriving them from the
             camera's own frustum puts them in the same place at any field of
             view, aspect ratio or window size, and keeps them the same
             apparent size while it is being eased between the two. */
          hands[i].position.set(
            side * halfW * (0.66 - crouch * 0.03) + sway * side,
            -halfH * (0.80 + crouch * 0.05) + lift - drop,
            Z + Math.abs(sway) * 0.4
          );
          hands[i].scale.setScalar(halfH * 1.06);
          hands[i].rotation.z = side * (0.35 + sway * 2.0);
          hands[i].rotation.x = -0.35 + lift * 2.0;
        }
      },
      dispose() { for (const m of owned) m.dispose(); },
    };
  }

  /* A floating name, for anyone who is not one of the four friends -- the
     other people at the table, who arrive with names this file has never heard
     of. Same maker as the crew's own tags so they read as one thing. */
  function nameTag(text, colour) {
    return makeTag(text, colour, { size: 0.155, font: 30 });
  }

  /* The pit boss.

     Heat, made into a person. A number in the corner going up is something you
     read; a man in a black suit walking towards the table you are winning at is
     something you feel, and it is the reason the room exists rather than a menu
     of machines. He is slow enough to outwalk, which is the point: the answer
     to him is always to go and play somewhere else.

     Built from the same parts as everyone else, in black, with no hat. */
  const BOSS_LOOK = { body: 0x2b2b31, hat: null, height: 1.12, width: 1.10 };
  const BOSS_WALK = 1.35;

  function createBoss(opts) {
    const { level, lib } = opts;
    let body = null;
    let tag = null;
    const pos = new THREE.Vector3();
    const dest = new THREE.Vector3();
    let yaw = 0, wantYaw = 0, cycle = 0, out = false, blocked = 0, detour = 0, detourSign = 1;

    function appear(at) {
      if (body) return;
      try {
        body = buildBody(lib, BOSS_LOOK);
      } catch (err) {
        console.warn('[gwyf] the pit boss could not be drawn', err);
        return;
      }
      tag = nameTag('Pit boss', '#ff9f2e');
      tag.position.y = body.joints.height * 0.98;
      body.group.add(tag);
      level.group.add(body.group);
      pos.copy(at || new THREE.Vector3(level.lift.x, 0, level.lift.z));
      body.group.position.copy(pos);
      out = true;
    }

    function leave() {
      if (!body) return;
      if (body.group.parent) body.group.parent.remove(body.group);
      if (tag && tag.userData.dispose) tag.userData.dispose();
      body.dispose();
      body = null; tag = null; out = false;
    }

    /* Head for wherever the player is. `target` is null when he has no reason
       to be here, and he goes back to the lift and off the floor. */
    function update(dt, target) {
      if (!body) return null;
      dest.copy(target || new THREE.Vector3(level.lift.x, 0, level.lift.z));
      const dx = dest.x - pos.x, dz = dest.z - pos.z;
      const dist = Math.hypot(dx, dz);
      let moved = 0;
      if (dist > 1.1) {
        let ux = dx / dist, uz = dz / dist;
        if (detour > 0) {
          detour -= dt;
          const px = -uz * detourSign * 1.5, pz = ux * detourSign * 1.5;
          const len = Math.hypot(ux + px, uz + pz) || 1;
          ux = (ux + px) / len; uz = (uz + pz) / len;
        }
        const step = { x: pos.x + ux * BOSS_WALK * dt, z: pos.z + uz * BOSS_WALK * dt };
        level.solids.resolve(step, RADIUS);
        level.solids.bound(step, RADIUS);
        moved = Math.hypot(step.x - pos.x, step.z - pos.z);
        pos.x = step.x; pos.z = step.z;
        if (moved < BOSS_WALK * dt * 0.4) {
          blocked += dt;
          if (blocked > 0.35 && detour <= 0) { detour = 1.4; detourSign = rand() < 0.5 ? 1 : -1; }
        } else blocked = Math.max(0, blocked - dt);
        wantYaw = Math.atan2(-ux, -uz);
      }
      let d = wantYaw - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      yaw += d * Math.min(1, TURN * dt);
      body.group.position.set(pos.x, 0, pos.z);
      body.group.rotation.y = yaw;

      // He does not waddle. Hands behind the back, and a slow rock.
      cycle += (moved > 0.01 ? moved * 2.0 : dt * 1.1);
      const beat = Math.sin(cycle);
      body.root.rotation.z = beat * 0.05;
      body.root.position.y = Math.abs(Math.cos(cycle)) * (moved > 0.01 ? 0.025 : 0.004);
      body.root.rotation.x = -0.05;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        body.hands[i].position.set(side * 0.30, 0.50, 0.20);
        body.hands[i].rotation.z = side * 0.2;
      }
      body.brow.rotation.x = 0.28;   // permanently unimpressed
      return pos;
    }

    return {
      appear, leave, update,
      get position() { return pos; },
      get here() { return out; },
      dispose: leave,
    };
  }

  global.GWCrew = { create, createBoss, buildBody, buildHands, nameTag, LOOK, YOU };
})(window);
