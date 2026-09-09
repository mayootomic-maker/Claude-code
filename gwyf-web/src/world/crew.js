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

  /* Everybody else in the building.

     The four named characters used to be your teammates, betting out of your
     account, and that is not the game this follows: it is one to six real
     people and no AI companions at all. So the room needs strangers instead --
     punters who are here for their own evening, playing with their own money,
     who happen to be standing at the machine you wanted.

     They are the same body and the same rig. What they do not have is a name
     tag, a colour you recognise, or any way to reach your bank. Drawn from a
     palette rather than a list, because the point of a crowd is that you
     cannot tell one of them from another. */
  const STRANGER_BODIES = [
    0x8fd3c7, 0xf2b8a2, 0xc9a9e0, 0x8fb8e8, 0xf2dd9a, 0xf29fae,
    0xa8d49a, 0xe8a9c9, 0x9ad0e0, 0xe0c08f, 0xb8a9e8, 0xf2c9a2,
  ];
  const STRANGER_HATS = [null, null, 'pin_hat_top', 'pin_hat_fez',
                         'pin_hat_boater', 'pin_monocle'];

  /* How many are on a floor, by how big it is.

     Roughly one per hundred and sixty square metres, which puts eight in the
     Ground Floor's fifty-six by forty and four in the Penthouse. More than
     that and a hall reads as a crush; fewer and it reads as a showroom after
     closing. */
  function crowdFor(level) {
    if (level.isLobby) return 3;
    const area = level.size.w * level.size.d;
    return Math.max(3, Math.min(9, Math.round(area / 160)));
  }

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
      setColour(colour) { if (skin && colour !== undefined) skin.color.set(colour); },
      wearing: [], wornMats: [],
      dispose() {
        for (const m of owned) m.dispose();
        for (const m of this.wornMats) m.dispose();
      },
    };
  }

  /* --- the gesture vocabulary ------------------------------------------------

     Every deliberate movement a body can make, in one table, because there are
     two entirely separate things that need to make them and a vocabulary that
     lives in one of them is a vocabulary the other cannot use. The crowd on the
     floor is animated by the full rig below -- states, springs, blending; the
     other players in your lobby are animated by twenty lines in `net/session.js`
     that interpolate a position and swing two hands. Both have to be able to
     wave.

     So a pose is a pure function of how far through it you are and returns
     offsets, and the two animators add those offsets to whatever else they were
     doing. Nothing here touches a body directly.

       g  0 at the start, 1 in the middle, 0 at the end -- so a wave begins and
          ends with the arm down instead of snapping to it
       t  0 to 1 across the whole gesture, for anything that has to travel
       d  how many seconds the whole thing lasts, for beats that should keep the
          same tempo whether it runs for one second or three

     `rank` is what a running gesture will not be interrupted by: cheering over
     a shrug is fine, shrugging over a cheer is not. `emote` marks the ones a
     player can ask for from the wheel, which is most but not all of them --
     `check` is somebody looking at their watch because the clock is running
     out, and nobody needs a button for that. */
  const POSES = {
    greet: {
      rank: 1, emote: true, label: 'Wave', key: '1', seconds: 1.6, say: 'greet',
      pose(g, t, d) {
        const beat = Math.sin(t * d * 9);
        return { handLift: g * 0.62, handOut: g * (0.16 + beat * 0.07),
                 headTilt: -g * 0.10, browTilt: -g * 0.3, roll: g * beat * 0.035 };
      },
    },
    point: {
      // The head follows the arm; `turnToAt` is the flag that asks for it, and
      // only the full rig knows where in the room the thing being pointed at is.
      rank: 2, emote: true, label: 'Point', key: '2', seconds: 1.4,
      pose(g) {
        return { handLift: g * 0.30, handOut: g * 0.34, lean: -g * 0.06,
                 turnToAt: true };
      },
    },
    shrug: {
      // The whole point of a shrug is that it is over before it is finished.
      rank: 2, emote: true, label: 'Shrug', key: '3', seconds: 1.2,
      pose(g) {
        return { handOut: g * 0.26, handLift: g * 0.16, headTilt: g * 0.14,
                 browTilt: -g * 0.35, squash: g * 0.03 };
      },
    },
    cheer: {
      rank: 3, emote: true, label: 'Cheer', key: '4', seconds: 1.5, say: 'cheer',
      pose(g, t) {
        return { handLift: g * 0.66, handOut: g * 0.14,
                 rise: g * Math.abs(Math.sin(t * 11)) * 0.10,
                 browTilt: -g * 0.5, headTilt: -g * 0.18 };
      },
    },
    check: {
      // A look at the wrist. Not an emote: this is what somebody does when the
      // clock is nearly out, and it should mean that rather than being a button.
      rank: 0, seconds: 1.6,
      pose(g) {
        return { handLift: g * 0.34, handOut: -g * 0.10, headTilt: g * 0.30,
                 lean: g * 0.08, browTilt: g * 0.25 };
      },
    },

    /* The ones added for the wheel. Bigger and longer than the reactions
       above, because an emote is something you chose to do and stood there
       doing -- a reaction that reads at a glance would be over before anybody
       looked up. */
    laugh: {
      rank: 3, emote: true, label: 'Laugh', key: '5', seconds: 2.0, say: 'laugh',
      pose(g, t, d) {
        // Doubled over and shaking, from the waist rather than the shoulders.
        const shake = Math.sin(t * d * 13);
        return { lean: g * (0.34 + shake * 0.09), headTilt: g * 0.42,
                 handLift: g * 0.22, handOut: -g * 0.06,
                 browTilt: -g * 0.4, squash: g * 0.05,
                 rise: -g * 0.04 + g * Math.abs(shake) * 0.03 };
      },
    },
    dance: {
      /* Two and a bit turns on the spot with the hands up, which is the only
         emote here that moves the body's own yaw. It is also the longest, on
         the grounds that a dance you can do in one second is a twitch. */
      rank: 4, emote: true, label: 'Dance', key: '6', seconds: 3.4,
      pose(g, t, d) {
        const beat = Math.sin(t * d * 7.5);
        return { spin: g * t * Math.PI * 4.4,
                 handLift: g * (0.5 + beat * 0.18), handOut: g * 0.2,
                 roll: g * beat * 0.16, rise: g * Math.abs(beat) * 0.09,
                 headTilt: -g * 0.12, browTilt: -g * 0.35,
                 squash: -g * Math.abs(beat) * 0.04 };
      },
    },
    clap: {
      rank: 2, emote: true, label: 'Clap', key: '7', seconds: 1.8,
      pose(g, t, d) {
        // The hands come together rather than apart, so `handOut` goes
        // negative on the beat -- a clap where the hands never meet is a wave.
        const beat = Math.abs(Math.sin(t * d * 8));
        return { handLift: g * 0.34, handOut: -g * beat * 0.2,
                 lean: g * 0.05, browTilt: -g * 0.25, headTilt: -g * 0.06 };
      },
    },
    sulk: {
      // For losing everything, which happens often enough to deserve a button.
      rank: 1, emote: true, label: 'Sulk', key: '8', seconds: 2.2, say: 'sulk',
      pose(g, t) {
        const sway = Math.sin(t * 4);
        return { headTilt: g * 0.5, lean: g * 0.16, handLift: -g * 0.16,
                 browTilt: g * 0.55, squash: g * 0.07,
                 rise: -g * 0.05, roll: g * sway * 0.03 };
      },
    },
  };

  /* Write a pose onto a body that has no rig behind it.

     `net/session.js` animates the other players in your lobby with a position
     lerp and a two-hand swing -- no states, no springs, no blending -- because
     that is all a peer needs and a second copy of the rig would be a second
     copy of the rig. This lets those bodies make the same gestures anyway.

     Fields the simple animator writes itself every frame are added to; fields
     nothing else touches are set outright, so calling this with a null pose is
     how a body stops gesturing rather than staying stuck in one. */
  function applyPose(body, o) {
    const p = o || ZERO;
    const J = body.joints;
    body.root.rotation.x = -p.lean;
    body.root.rotation.y = p.spin;
    body.root.rotation.z += p.roll;
    body.root.position.y += p.rise;
    body.head.rotation.x = -p.headTilt;
    body.brow.rotation.x = -p.browTilt * 0.42;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      body.hands[i].position.x = side * (J.handX + p.handOut);
      body.hands[i].position.y = J.hand + p.handLift;
      body.hands[i].rotation.z = side * (0.10 + p.handLift * 0.5);
    }
  }

  /* Work out a pose, safely. An unknown name gets nothing rather than throwing
     -- an emote arriving over the network is a string somebody else's build
     chose, and a peer on a newer version must not be able to crash yours. */
  const ZERO = { handLift: 0, handOut: 0, headTilt: 0, browTilt: 0, roll: 0,
                 lean: 0, rise: 0, squash: 0, spin: 0, turnToAt: false };
  function POSE(name, g, t, seconds) {
    const def = POSES[name];
    if (!def) return null;
    return Object.assign({}, ZERO, def.pose(g, t, seconds || def.seconds || 1));
  }

  // The ones a player can ask for, in the order the wheel shows them.
  const EMOTES = Object.keys(POSES)
    .filter((k) => POSES[k].emote)
    .map((k) => ({ id: k, label: POSES[k].label, key: POSES[k].key,
                   seconds: POSES[k].seconds, say: POSES[k].say || null }));

  /* --- cosmetics ------------------------------------------------------------

     Thirty-odd things you can wear, built out of primitives rather than
     modelled. The character is a pin with two enormous eyes and a heavy brow
     bar; at the size anybody sees it, a cone on the crown reads as a party hat
     and two dark discs over the eyes read as shades. Modelling each one in
     Blender would be thirty exports to say what a cylinder already says.

     Everything is authored around the head's own origin with the face at -Z,
     which is the convention the models use: they are drawn facing Blender's +Y
     and the exporter turns that into three.js's -Z. Getting that backwards is
     how the monocle first ended up on the back of somebody's skull.

     Each builder returns an Object3D and says nothing about where it goes; the
     table below says which node it hangs from. */
  const WEARABLE = {
    /* Hats and hair, on the crown. */
    cone(mat) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.42, 16), mat);
      m.position.y = 0.60;
      return m;
    },
    dome(mat) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), mat);
      m.position.y = 0.30;
      return m;
    },
    bucket(mat) {
      const g = new THREE.Group();
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.235, 0.20, 18), mat);
      crown.position.y = 0.47;
      g.add(crown);
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.325, 0.045, 20), mat);
      brim.position.y = 0.375;
      g.add(brim);
      return g;
    },
    crown(mat) {
      const g = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.09, 18), mat);
      band.position.y = 0.44;
      g.add(band);
      // Five points, which is what a crown is once you take the band away.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 8), mat);
        spike.position.set(Math.sin(a) * 0.20, 0.56, Math.cos(a) * 0.20);
        g.add(spike);
      }
      return g;
    },
    visor(mat) {
      const g = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.075, 18), mat);
      band.position.y = 0.40;
      g.add(band);
      const peak = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.30, 0.03, 18,
        1, false, Math.PI * 0.72, Math.PI * 0.56), mat);
      peak.position.set(0, 0.385, 0);
      g.add(peak);
      return g;
    },
    halo(mat) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.026, 8, 20), mat);
      m.position.y = 0.66;
      m.rotation.x = Math.PI / 2;
      return m;
    },
    mop(mat) {
      const g = new THREE.Group();
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.272, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.46), mat);
      cap.position.y = 0.315;
      g.add(cap);
      // A ring of tufts round the back and sides. None at the front: hair over
      // the brow bar covers the only expression this face has.
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.28 + (i / 8) * Math.PI * 1.44;
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.062, 8, 6), mat);
        tuft.position.set(Math.sin(a) * 0.245, 0.30, Math.cos(a) * 0.245);
        g.add(tuft);
      }
      return g;
    },
    bun(mat) {
      const g = new THREE.Group();
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.262, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.44), mat);
      cap.position.y = 0.315;
      g.add(cap);
      const knot = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 10), mat);
      knot.position.set(0, 0.60, 0.05);
      g.add(knot);
      return g;
    },

    /* Faces. The brow bar sits at about y = 0.35 on the head and the eyes just
       under it, so anything worn on the face lives between 0.10 and 0.30. */
    bar(mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.030, 0.035), mat);
      m.position.set(0, 0.085, -0.245);
      return m;
    },
    walrus(mat) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), mat);
      body.scale.set(1.9, 0.5, 0.55);
      body.position.set(0, 0.07, -0.238);
      g.add(body);
      return g;
    },
    handlebar(mat) {
      const g = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.028, 0.032), mat);
      bar.position.set(0, 0.085, -0.245);
      g.add(bar);
      for (const side of [-1, 1]) {
        const curl = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.016, 6, 12,
          Math.PI * 1.4), mat);
        curl.position.set(side * 0.095, 0.10, -0.243);
        curl.rotation.y = Math.PI / 2;
        curl.rotation.z = side < 0 ? Math.PI : 0;
        g.add(curl);
      }
      return g;
    },
    chin(mat) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), mat);
      m.scale.set(1.05, 0.55, 0.45);
      m.position.set(0, -0.045, -0.185);
      return m;
    },
    goatee(mat) {
      const g = new THREE.Group();
      const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.15, 8), mat);
      tuft.position.set(0, -0.10, -0.215);
      tuft.rotation.x = -0.25;
      g.add(tuft);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.028, 0.03), mat);
      strip.position.set(0, 0.075, -0.245);
      g.add(strip);
      return g;
    },
    fullbeard(mat) {
      const g = new THREE.Group();
      const mass = new THREE.Mesh(new THREE.SphereGeometry(0.215, 16, 12), mat);
      mass.scale.set(1.0, 0.85, 0.62);
      mass.position.set(0, -0.10, -0.145);
      g.add(mass);
      const tache = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.032, 0.035), mat);
      tache.position.set(0, 0.085, -0.245);
      g.add(tache);
      return g;
    },
    shades(mat) {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.075, 0.022), mat);
        lens.position.set(side * 0.085, 0.235, -0.242);
        g.add(lens);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.02), mat);
      bridge.position.set(0, 0.245, -0.242);
      g.add(bridge);
      return g;
    },
    specs(mat) {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.011, 6, 16), mat);
        rim.position.set(side * 0.082, 0.235, -0.238);
        g.add(rim);
      }
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.014), mat);
      bridge.position.set(0, 0.235, -0.238);
      g.add(bridge);
      return g;
    },
    patch(mat) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.10, 0.02), mat);
      pad.position.set(-0.085, 0.235, -0.242);
      g.add(pad);
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.010, 6, 24,
        Math.PI * 1.1), mat);
      strap.position.set(0, 0.255, 0);
      strap.rotation.x = Math.PI / 2;
      strap.rotation.z = 0.35;
      g.add(strap);
      return g;
    },

    /* Worn on the body, which is a tapered pin about 0.9 tall with its collar
       around y = 0.78. */
    bowtie(mat) {
      const g = new THREE.Group();
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.10, 4), mat);
        wing.position.set(side * 0.055, 0.795, -0.20);
        wing.rotation.z = side * Math.PI / 2;
        g.add(wing);
      }
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 0.035), mat);
      knot.position.set(0, 0.795, -0.20);
      g.add(knot);
      return g;
    },
    tie(mat) {
      const g = new THREE.Group();
      const knot = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.03), mat);
      knot.position.set(0, 0.79, -0.205);
      g.add(knot);
      const blade = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.30, 4), mat);
      blade.position.set(0, 0.62, -0.215);
      blade.rotation.x = Math.PI;
      g.add(blade);
      return g;
    },
    scarf(mat) {
      const g = new THREE.Group();
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.175, 0.055, 8, 18), mat);
      wrap.position.y = 0.775;
      wrap.rotation.x = Math.PI / 2;
      g.add(wrap);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.28, 0.05), mat);
      tail.position.set(0.09, 0.62, -0.16);
      tail.rotation.z = 0.18;
      g.add(tail);
      return g;
    },
    chain(mat) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.018, 8, 22), mat);
      m.position.y = 0.735;
      m.rotation.x = Math.PI / 2 - 0.22;
      return m;
    },
    sash(mat) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.62, 0.36), mat);
      m.position.set(0, 0.50, 0);
      m.rotation.z = 0.55;
      return m;
    },
    waistcoat(mat) {
      const g = new THREE.Group();
      const front = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.30, 0.44, 16,
        1, true, Math.PI * 0.66, Math.PI * 0.68), mat);
      front.position.y = 0.50;
      g.add(front);
      return g;
    },
    apron(mat) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.335, 0.50, 16,
        1, true, Math.PI * 0.62, Math.PI * 0.76), mat);
      m.position.y = 0.36;
      return m;
    },
    belt(mat) {
      const g = new THREE.Group();
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.315, 0.325, 0.075, 18), mat);
      band.position.y = 0.42;
      g.add(band);
      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.075, 0.04), mat);
      buckle.position.set(0, 0.42, -0.315);
      g.add(buckle);
      return g;
    },
  };

  // Which node a section hangs off. The head turns and tilts, so anything worn
  // on the face has to travel with it; the body does not.
  const WORN_ON = {
    hat: 'head', hair: 'head', mustache: 'head', beard: 'head',
    facewear: 'head', neck: 'root', clothing: 'root',
  };

  /* Put on what somebody is wearing.

     Called on a fresh body and again whenever the wardrobe changes, so it
     clears what was there first. Materials are tracked on the body so the one
     dispose still frees everything -- a wardrobe you can change thirty times a
     night is thirty leaked materials a night otherwise. */
  function dressBody(lib, body, worn) {
    if (body.wearing) {
      for (const obj of body.wearing) if (obj.parent) obj.parent.remove(obj);
      for (const m of body.wornMats) m.dispose();
    }
    body.wearing = [];
    body.wornMats = [];
    if (!worn) return;

    for (const section of Object.keys(worn)) {
      const id = worn[section];
      if (!id) continue;
      const def = (global.GWConfig.COSMETICS || []).find((c) => c.id === id);
      if (!def) continue;
      const parent = WORN_ON[def.section] === 'root' ? body.root : body.head;
      let obj = null;
      if (def.model) {
        try {
          obj = GWModels.instance(lib, def.model);
          obj.traverse((o) => { if (o.isMesh) o.userData.shared = true; });
          if (def.model === 'pin_monocle') {
            obj.position.set(-0.120, 0.262, -0.232);
            obj.rotation.x = Math.PI / 2;
          } else {
            obj.position.y = 0.395;
          }
        } catch (err) {
          // A missing mesh loses a hat, not the person wearing it.
          console.warn('[gwyf] no cosmetic mesh for ' + id, err);
          obj = null;
        }
      } else if (WEARABLE[def.build]) {
        const mat = new THREE.MeshStandardMaterial({
          color: def.colour === undefined ? 0xcccccc : def.colour,
          roughness: def.build === 'chain' || def.build === 'halo' ? 0.28 : 0.72,
          metalness: def.build === 'chain' || def.build === 'halo' ? 0.85 : 0.05,
        });
        body.wornMats.push(mat);
        obj = WEARABLE[def.build](mat);
      }
      if (!obj) continue;
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      parent.add(obj);
      body.wearing.push(obj);
    }
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
    /* Marked as people, not architecture.

       The camera's search for a clear view of a table treats anything solid as
       a permanent obstruction and moves the shot to avoid it. A friend walking
       past is neither permanent nor worth reframing for -- and because they
       move, counting them made the same seed report different tables blocked
       from one run to the next. */
    group.traverse((o) => { o.userData.person = true; });
    level.group.add(group);

    /* One body, named or not.

       A name tag is the whole difference between somebody at the table with
       you and somebody who happens to be at the same table. Real players get
       one in their own colour; the crowd gets none, because a room where every
       stranger is captioned is a scoreboard with a casino behind it. */
    function addPerson(mate, look, named) {
      let body;
      try {
        body = buildBody(lib, look);
      } catch (err) {
        // A missing person mesh must not take the floor down with it.
        console.warn('[gwyf] no body for ' + mate.id, err);
        return null;
      }
      /* A shadow where they meet the carpet.

         The bodies are one flat colour with no occlusion anywhere on them, so
         under a lit room they read as paper cut-outs standing in front of the
         floor rather than on it. The shadow map does not help: it is cast from
         one directional light across a thirty-metre hall, and at that scale a
         pin's own shadow is a few pixels somewhere else. A soft blob under
         each of them is what puts them in the room, and it is the same helper
         every game already uses to ground a die. */
      const shadow = GWStage.contactShadow(0.34 * look.width, 0.42);
      shadow.position.y = 0.012;
      shadow.renderOrder = -1;
      body.group.add(shadow);

      let tag = null;
      if (named) {
        // Small. A label you can read at four metres is a billboard at two.
        tag = makeTag(mate.name, mate.colour, { size: 0.155, font: 30 });
        tag.position.y = body.joints.height * 0.98;
        body.group.add(tag);
      }

      const person = {
        mate, look, body, tag, bubble: null, bubbleLeft: 0,
        stranger: !named,
        pos: new THREE.Vector3(), yaw: 0, wantYaw: 0,
        dest: null, at: null, state: 'idle',
        cycle: 0, blocked: 0, detour: 0, detourSign: 1,
        mood: 0, moodLeft: 0, idleFor: 0, tilting: false, offering: false, anchor: null,
        lookAtPlayer: 0,
        /* A gesture is a one-shot on top of the blend: a name, how long it has
           left, and how long it started with, so the pose can be shaped over
           its own life rather than switched on and off. `gestureAt` is what is
           being pointed at, in world space. */
        gesture: null, gestureLeft: 0, gestureFor: 1, gestureAt: null,
        greeted: 0,
        // How long a stranger stays at a machine before drifting off, and how
        // long they wander before picking another one.
        stay: 0,
      };
      spawnAt(person);
      group.add(body.group);
      people.push(person);
      return person;
    }

    for (const mate of store.s.friends) {
      addPerson(mate, Object.assign({}, FALLBACK, LOOK[mate.id] || {}), true);
    }

    /* The crowd.

       Deliberately after the named ones, so a stranger never takes the spawn
       spot a player was going to get, and deliberately built from Math.random
       rather than the run's stream: who is wearing a boater is not something a
       reload has to reproduce, and pouring draws into the seeded stream would
       stop it reproducing the things that matter. */
    for (let i = 0; i < crowdFor(level); i++) {
      const look = {
        body: STRANGER_BODIES[Math.floor(rand() * STRANGER_BODIES.length)],
        hat: STRANGER_HATS[Math.floor(rand() * STRANGER_HATS.length)],
        height: 0.9 + rand() * 0.22,
        width: 0.9 + rand() * 0.26,
      };
      const person = addPerson({ id: 'stranger' + i, name: null, colour: look.body },
                               look, false);
      // Staggered, or the whole crowd sets off for a table on the same frame.
      if (person) person.stay = rand() * 6;
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
    // A stranger has no tag, so a speech bubble sits where the tag would be.
    const tagHalf = (person) => (person.tag ? person.tag.scale.y / 2 : 0.08);

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
      /* Point at where they are off to.

         A friend announcing a bet used to turn on the spot and set off, and
         from across a hall that is indistinguishable from wandering. Pointing
         at the table first says both that they have decided something and
         which machine they decided it about. */
      if (person.dest) doGesture(person, 'point', 1.4, person.dest);
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
      // Winning is worth pointing at; losing is worth a shrug.
      doGesture(person, net > 0 ? 'cheer' : 'shrug', net > 0 ? 1.5 : 1.2);
    }

    /* --- gestures -----------------------------------------------------------

       A gesture is a short, deliberate movement laid over whatever the body is
       already doing: a point, a wave, a shrug, a look at a watch. They exist
       because the crew had exactly three things to say with their bodies --
       walking, playing and how the last hand went -- and a room where nobody
       ever acknowledges anybody is a room full of furniture that breathes.

       Nothing here interrupts. A gesture is a weight that comes and goes, so a
       friend who starts walking mid-wave finishes the wave while they walk. */
    function doGesture(person, name, seconds, at) {
      // A gesture already running is only replaced by a fresher one of at
      // least equal standing: a wave must not stamp on a cheer.
      if (!POSES[name]) return;
      const rank = (n) => (POSES[n] && POSES[n].rank) || 0;
      if (person.gesture && person.gestureLeft > 0
          && rank(person.gesture) > rank(name)) return;
      person.gesture = name;
      person.gestureFor = seconds;
      person.gestureLeft = seconds;
      person.gestureAt = at ? at.clone() : null;
    }

    /* What the crew does when something happens to *you*.

       They bet their own money and reacted to their own results, and stood
       there like fence posts while the player took the building apart. `kind`
       is what happened; how loud the reaction is depends on how far away they
       are, because three people cheering from across a hall at a two-dollar
       win is worse than silence. */
    function react(kind, at) {
      for (const person of people) {
        if (person.state === 'away') continue;
        const near = at ? person.pos.distanceTo(at) : 0;
        if (near > 14) continue;
        if (kind === 'win') {
          person.mood = 1; person.moodLeft = near < 7 ? 1.9 : 1.2;
          doGesture(person, 'cheer', 1.5);
        } else if (kind === 'loss') {
          person.mood = -1; person.moodLeft = 1.6;
          doGesture(person, 'shrug', 1.1);
        } else if (kind === 'late') {
          doGesture(person, 'check', 1.6);
        } else if (kind === 'point' && at) {
          doGesture(person, 'point', 1.8, at);
        }
      }
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
          // Strangers have no money in this game and never call it.
          if (wasWalkingToTable && !person.stranger) onArrive(person.mate.id);
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
        if (person.stranger) {
          person.stay -= dt;
          if (person.stay <= 0) {
            // Somebody's evening ends the way everybody's does.
            const net = rand() < 0.42 ? 1 : -1;
            person.mood = net; person.moodLeft = 1.6;
            doGesture(person, net > 0 ? 'cheer' : 'shrug', net > 0 ? 1.4 : 1.1);
            person.at = null;
            person.state = 'idle';
            person.idleFor = 0;
            person.stay = 3 + rand() * 7;
          }
        }
      } else {
        person.idleFor += dt;
        if (person.stranger) {
          /* A stranger with nothing to do finds a machine.

             They are not betting anything of yours -- there is no money in
             this at all, and it never touches the bank -- they are here for
             their own evening and the point of them is that the machine you
             wanted has somebody at it. Held off for a few seconds after
             arriving so the whole crowd does not converge on one table on the
             frame the floor loads. */
          person.stay -= dt;
          if (person.stay <= 0) {
            const free = (level.anchors || []).filter((a) => a.kind === 'machine'
              && !people.some((q) => q !== person && q.at === a));
            if (free.length) {
              person.at = free[Math.floor(rand() * free.length)];
              person.dest = besideStand(person.at);
              person.state = 'walk';
              // How long they will stand there once they get there.
              person.stay = 8 + rand() * 18;
            } else {
              person.stay = 4 + rand() * 6;
            }
          }
        }
        // Loiter. Standing perfectly still for five minutes is what makes a
        // character read as a prop.
        if (!person.dest && person.idleFor > 6 + rand() * 8) {
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
      if (person.greeted > 0) person.greeted -= dt;
      if (playerPos) {
        const dx = playerPos.x - person.pos.x;
        const dz = playerPos.z - person.pos.z;
        if (Math.hypot(dx, dz) < 5.0) {
          let off = Math.atan2(-dx, -dz) - person.yaw;
          while (off > Math.PI) off -= Math.PI * 2;
          while (off < -Math.PI) off += Math.PI * 2;
          if (Math.abs(off) < 1.9) {
            person.lookAtPlayer = Math.max(-0.85, Math.min(0.85, off));
            /* And say hello, once. Walking up to somebody who looks at you and
               does nothing else is worse than being ignored, and a wave every
               time you passed would be a nervous tic -- so it fires inside two
               and a half metres and then holds off for half a minute. */
            if (Math.hypot(dx, dz) < 2.5 && person.greeted <= 0
                && !person.dest && person.state !== 'play') {
              person.greeted = 30;
              doGesture(person, 'greet', 1.3);
            }
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
      let lean = 0, roll = 0, rise = 0, squash = 0, bank = 0, spin = 0;
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

      /* --- gestures, laid over the top -------------------------------------

         Each one is shaped over its own life rather than switched on flat: `g`
         rises and falls so a wave starts and ends with the arm down, and a
         point settles rather than snapping out. Nothing here is exclusive with
         the states above -- somebody can be walking, pleased with themselves
         and checking the time at once, which is what people do. */
      if (person.gestureLeft > 0) {
        person.gestureLeft = Math.max(0, person.gestureLeft - dt);
        const t = 1 - person.gestureLeft / person.gestureFor;
        // In over the first fifth, out over the last quarter.
        const g = Math.min(1, t / 0.2, (1 - t) / 0.25);

        const pose = POSE(person.gesture, g, t, person.gestureFor);
        if (pose) {
          handLift += pose.handLift; handOut += pose.handOut;
          headTilt += pose.headTilt; browTilt += pose.browTilt;
          roll += pose.roll; lean += pose.lean;
          rise += pose.rise; squash += pose.squash;
          spin += pose.spin;
          // Pointing at something you are not looking at reads as a spasm, so
          // the head follows the arm -- the one part of a pose that needs to
          // know where in the room the thing is.
          if (pose.turnToAt && person.gestureAt) {
            const want = Math.atan2(-(person.gestureAt.x - person.pos.x),
                                    -(person.gestureAt.z - person.pos.z));
            let off = want - person.yaw;
            while (off > Math.PI) off -= Math.PI * 2;
            while (off < -Math.PI) off += Math.PI * 2;
            headTurn += g * Math.max(-1.1, Math.min(1.1, off));
          }
        }
        if (person.gestureLeft === 0) { person.gesture = null; person.gestureAt = null; }
      }

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
      // Turned on the spot, inside the group that carries their facing -- so a
      // dance spins the body without the walker losing track of which way they
      // are pointed once it finishes.
      body.root.rotation.y = spin;
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
        if (person.tag) person.tag.userData.dispose();
        person.body.dispose();
      }
      people.length = 0;
      if (group.parent) group.parent.remove(group);
    }

    return {
      people, update, go, settled, speak, tilt, offer, react, dispose, group,
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
    let handEmote = null, handEmoteFor = 1, handEmoteLeft = 0;
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
      /* Repainted rather than rebuilt.

         The bath can be climbed into as often as you like, and your two hands
         are in nearly every frame of the game -- tearing them down and building
         them again for a colour change drops a frame every time somebody
         fiddles with the palette. */
      setColour(colour) { if (skin && colour !== undefined) skin.color.set(colour); },
      /* Do an emote with your own two hands.

         You cannot see yourself: the whole of you, from where you are stood,
         is two mittens in the bottom corners of the frame. So pressing an
         emote and having it happen only on everybody else's screen is a button
         that appears to do nothing -- which is how the first pass of this felt
         to play, and it is the one thing an emote must not be.

         The hands are placed as a fraction of the frame rather than in metres
         (see below), so the pose is applied in the same units: a wave lifts
         them by a share of the visible height, not by half a metre. */
      emote(name) {
        const def = POSES[name];
        if (!def) return false;
        handEmote = name;
        handEmoteFor = def.seconds;
        handEmoteLeft = def.seconds;
        return true;
      },
      get emoting() { return handEmoteLeft > 0 ? handEmote : null; },

      /* Place them for this frame. `bob` is the walk phase, `speed` how fast,
         `fall` the vertical velocity so they drop when you do. `dt` advances
         whatever emote is running -- passed in rather than measured here,
         because the clock this game runs on lives in `lib/time.js`'s caller
         and a second one would drift against it. */
      update(bob, speed, fall, crouch, dt) {
        // Half the visible frame at the distance the hands are held, from the
        // camera's live field of view rather than a number written down once.
        const Z = -0.52;
        const halfH = Math.abs(Z) * Math.tan((camera.fov * Math.PI / 180) / 2);
        const halfW = halfH * camera.aspect;
        const sway = Math.sin(bob) * Math.min(0.035, speed * 0.012);
        const lift = Math.abs(Math.cos(bob)) * Math.min(0.03, speed * 0.010);
        const drop = Math.max(-0.10, Math.min(0.10, -fall * 0.016));

        // Whatever you are doing on purpose, over the top of all that.
        let e = null;
        if (handEmoteLeft > 0) {
          handEmoteLeft = Math.max(0, handEmoteLeft - (dt || 0));
          const et = 1 - handEmoteLeft / handEmoteFor;
          const g = Math.min(1, et / 0.2, (1 - et) / 0.25);
          e = POSE(handEmote, g, et, handEmoteFor);
          if (handEmoteLeft === 0) handEmote = null;
        }
        // Into the frame and towards the middle, so a wave is a wave rather
        // than a mitten twitching in the corner where you cannot see it.
        const eLift = e ? e.handLift * 1.5 : 0;
        const eIn = e ? e.handOut * 0.9 : 0;
        const eRoll = e ? e.roll * 3 : 0;

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
            side * halfW * (0.66 - crouch * 0.03 - eIn) + sway * side,
            -halfH * (0.80 + crouch * 0.05 - eLift) + lift - drop,
            Z + Math.abs(sway) * 0.4
          );
          hands[i].scale.setScalar(halfH * 1.06);
          hands[i].rotation.z = side * (0.35 + sway * 2.0) + eRoll;
          hands[i].rotation.x = -0.35 + lift * 2.0 - (e ? e.headTilt * 0.6 : 0);
        }
      },
      wearing: [], wornMats: [],
      dispose() {
        for (const m of owned) m.dispose();
        for (const m of this.wornMats) m.dispose();
      },
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
      body.group.traverse((o) => { o.userData.person = true; });
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

  global.GWCrew = { create, createBoss, buildBody, buildHands, dressBody, nameTag,
                    LOOK, YOU, COSMETIC_PREVIEW: WEARABLE,
                    POSES, POSE, EMOTES, applyPose };
})(window);
