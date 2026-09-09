/* What the bots know, what they think, and what they are willing to say.

   A bot that votes at random is not an opponent, it is a dice roll wearing a
   hat -- and it makes the meeting, which is the whole game, meaningless. So
   every bot keeps a small memory of what it actually saw, reasons from it, and
   argues out loud.

   Two halves, and they are deliberately asymmetric:

   **The detective.** A crew bot records sightings -- who, where, when -- and
   nothing else. It cannot see through walls and it does not consult the
   host's tables. When a body turns up it reasons over the window around the
   death: who was near, who was unaccounted for, who it can personally vouch
   for. Its confidence is bounded by what it witnessed, so it is beatable by
   anybody who is careful, and unbeatable by anybody who kills in front of it.

   **The liar.** An impostor bot keeps the same record, and uses it to pick a
   claim that will not be contradicted: a room it really was in, before the
   kill. It watches which way the room is leaning and leans the same way. It
   defends itself when named. It will occasionally report its own kill, which
   is the strongest move in the game and the one that most reliably makes a
   class shout.

   Everything a bot says is derived from something it observed. None of it is
   generated, none of it is looked up, and a bot cannot say a room name it was
   never in. That constraint is the whole reason the meetings are worth having:
   the bots can be caught out. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;

  const MEMORY_SECONDS = 100;
  const SIGHT = 330;
  const MURDER_WINDOW = 26;      // seconds before a body that count as "around then"

  const minds = new Map();
  let observeClock = 0;

  function mind(id) {
    if (!minds.has(id)) {
      minds.set(id, {
        id,
        sightings: [],        // { t, who, room }
        rooms: [],            // { t, room } -- where I was
        witnessed: {},        // who -> { kill, vent, at }
        bodies: [],           // { who, room, t, finder }
        accusedBy: {},        // who -> t
        heardClaims: {},      // who -> room
        suspicion: {},
        testimony: [],        // { from, about, kind, t }
        nextSpeak: 0,
        said: 0,
        spokeAbout: {},
      });
    }
    return minds.get(id);
  }

  function reset() {
    minds.clear();
    observeClock = 0;
  }

  const clock = (H) => Math.max(0, (U.now() - H.startedAt) / 1000);

  function trim(list, now) {
    while (list.length && now - list[0].t > MEMORY_SECONDS) list.shift();
  }

  /* ---- looking around ----------------------------------------------------- */

  /* Runs a couple of times a second for every bot, and only records what that
     bot could actually see: in range, and with no wall in the way. */
  function observe(dt, H) {
    if (H.phase !== 'play') return;
    observeClock -= dt;
    if (observeClock > 0) return;
    observeClock = 0.45;

    const now = clock(H);
    const ids = Object.keys(H.players);

    for (const id of ids) {
      const self = H.players[id];
      if (!self || !self.bot || !self.alive) continue;
      const me = NS.world.players.get(id);
      if (!me) continue;
      const my = mind(id);

      const room = M.roomAt(me.x, me.y);
      const last = my.rooms[my.rooms.length - 1];
      if (room && (!last || last.room !== room.name)) my.rooms.push({ t: now, room: room.name });
      trim(my.rooms, now);

      for (const other of ids) {
        if (other === id) continue;
        const them = H.players[other];
        if (!them || !them.alive || them.ghost) continue;
        const at = NS.world.players.get(other);
        if (!at || at.inVent) continue;
        if (H.invisible[other]) continue;
        if (U.dist(me.x, me.y, at.x, at.y) > SIGHT) continue;
        if (!NS.los.clear(me.x, me.y, at.x, at.y)) continue;
        const where = M.roomAt(at.x, at.y);
        my.sightings.push({ t: now, who: other, room: where ? where.name : 'a corridor' });
      }
      trim(my.sightings, now);
      if (my.sightings.length > 90) my.sightings.splice(0, my.sightings.length - 90);
    }
  }

  /* ---- being told things -------------------------------------------------- */

  /* A kill only registers for a bot that could see it happen. This is the one
     piece of certain evidence in the game and it has to be earned. */
  function witnessKill(H, killerId, victimId, x, y) {
    const now = clock(H);
    for (const [id, my] of minds) {
      const p = H.players[id];
      if (!p || !p.alive || id === killerId) continue;
      const me = NS.world.players.get(id);
      if (!me) continue;
      if (U.dist(me.x, me.y, x, y) > SIGHT) continue;
      if (!NS.los.clear(me.x, me.y, x, y)) continue;
      my.witnessed[killerId] = { kill: true, at: now };
    }
  }

  function witnessVent(H, venterId, x, y) {
    const now = clock(H);
    for (const [id, my] of minds) {
      const p = H.players[id];
      if (!p || !p.alive || id === venterId) continue;
      const me = NS.world.players.get(id);
      if (!me) continue;
      if (U.dist(me.x, me.y, x, y) > SIGHT) continue;
      if (!NS.los.clear(me.x, me.y, x, y)) continue;
      const seen = my.witnessed[venterId] || (my.witnessed[venterId] = { at: now });
      seen.vent = true;
      seen.at = now;
    }
  }

  /* Everybody learns a body was found, because the meeting says so. Where and
     when it happened is what they reason over. */
  function noteBody(H, finderId, body) {
    const now = clock(H);
    const room = M.roomAt(body.x, body.y);
    for (const [, my] of minds) {
      my.bodies.push({
        who: body.id, room: room ? room.name : 'a corridor', t: now, finder: finderId,
      });
      if (my.bodies.length > 6) my.bodies.shift();
    }
  }

  /* A bot notices its own name in the chat and treats that as being accused.
     Crude on purpose: matching a name is something a bot can genuinely do,
     and pretending to understand the sentence would be a lie about how it
     works. */
  /* Testimony. A bot that only trusts its own eyes cannot be argued with, and
     three of them saying "I watched Rae do it" while everybody votes for
     somebody else is the meeting failing at the one thing it is for. So a
     spoken claim is delivered to every other mind as evidence -- discounted
     by how much the listener already distrusts the speaker, which is what
     stops one loud liar from steering the room. */
  function receiveClaim(H, fromId, claim) {
    if (!claim || !claim.about) return;
    for (const [id, my] of minds) {
      if (id === fromId) continue;
      const p = H.players[id];
      if (!p || !p.alive || !p.bot) continue;
      my.testimony.push({
        from: fromId, about: claim.about, kind: claim.kind, t: clock(H),
      });
      if (my.testimony.length > 40) my.testimony.shift();
    }
  }

  function hear(H, fromName, text) {
    const lower = String(text || '').toLowerCase();
    for (const [id, my] of minds) {
      const p = H.players[id];
      if (!p || !p.bot) continue;
      if (lower.indexOf(p.name.toLowerCase()) < 0) continue;
      my.accusedBy[fromName] = clock(H);
    }
    /* And everybody notes a room somebody claimed, so a second claim from the
       same person can be checked against it. */
    for (const room of M.ROOMS) {
      if (lower.indexOf(room.name.toLowerCase()) < 0) continue;
      for (const [, my] of minds) my.heardClaims[fromName] = room.name;
      break;
    }
  }

  /* ---- reasoning ---------------------------------------------------------- */

  function withMeAround(my, who, at) {
    return my.sightings.some((s) => s.who === who && Math.abs(s.t - at) < 8);
  }

  function lastSeenBefore(my, who, at) {
    let best = null;
    for (const s of my.sightings) {
      if (s.who !== who || s.t > at) continue;
      if (!best || s.t > best.t) best = s;
    }
    return best;
  }

  /* The suspicion model. Every term is something the bot could know. */
  function weigh(H, id) {
    const my = mind(id);
    const scores = {};
    const alive = Object.keys(H.players).filter((k) =>
      H.players[k].alive && H.players[k].connected && k !== id);
    for (const other of alive) scores[other] = 0;

    const body = my.bodies[my.bodies.length - 1];
    const when = body ? body.t : clock(H);

    for (const other of alive) {
      const saw = my.witnessed[other];
      if (saw && saw.kill) scores[other] += 120;
      if (saw && saw.vent) scores[other] += 75;

      if (body) {
        /* Anyone I saw in the room the body turned up in, shortly before it
           did. This is the ordinary bread of an Among Us meeting. */
        const near = my.sightings.some((s) =>
          s.who === other && s.room === body.room && body.t - s.t < MURDER_WINDOW && s.t <= body.t);
        if (near) scores[other] += 34;

        /* And whoever I never saw at all in that window is unaccounted for --
           weak, but it is what "where were you?" is actually asking. */
        const anywhere = my.sightings.some((s) => s.who === other && Math.abs(s.t - body.t) < MURDER_WINDOW);
        if (!anywhere) scores[other] += 12;

        /* Someone I was standing next to when it happened cannot have done
           it, and a bot should be as sure of that as a person would be. */
        if (withMeAround(my, other, body.t)) scores[other] -= 55;

        if (body.finder === other) scores[other] += 8;   // self-reports are a known move
      }

      /* Somebody who claimed a room I saw them nowhere near. */
      const claim = my.heardClaims[H.players[other].name];
      if (claim) {
        const backing = my.sightings.some((s) => s.who === other && s.room === claim);
        const contradicted = my.sightings.some((s) =>
          s.who === other && s.room !== claim && Math.abs(s.t - when) < 14);
        if (backing) scores[other] -= 20;
        else if (contradicted) scores[other] += 26;
      }

      /* Somebody who spent the round pointing at me. */
      if (my.accusedBy[H.players[other].name]) scores[other] += 10;
    }

    /* What other people said. An eyewitness claim is worth a great deal more
       than a "they were nearby", and both are worth less coming from somebody
       this bot already suspects. */
    for (const claim of my.testimony) {
      if (scores[claim.about] === undefined) continue;
      const speakerTrust = 1 - Math.min(0.8, Math.max(0, (scores[claim.from] || 0) / 160));
      const weight = claim.kind === 'witness' ? 58 : claim.kind === 'accuse' ? 20 : 0;
      scores[claim.about] += weight * speakerTrust;
    }

    /* An impostor knows which of these are safe and steers the rest. */
    if (C.ROLES[H.roles[id] || 'crewmate'].team === 'impostor') {
      for (const other of alive) {
        if (C.ROLES[H.roles[other] || 'crewmate'].team === 'impostor') scores[other] = -999;
      }
      /* Lean the way the room is already leaning. A liar who votes alone is a
         liar who gets voted next. */
      const votes = (H.meeting && H.meeting.votes) || {};
      for (const voter in votes) {
        const target = votes[voter];
        if (scores[target] !== undefined && scores[target] > -900) scores[target] += 30;
      }
      /* And whoever is looking at them. */
      for (const name in my.accusedBy) {
        const accuser = alive.find((k) => H.players[k].name === name);
        if (accuser && scores[accuser] > -900) scores[accuser] += 45;
      }
    }

    my.suspicion = scores;
    return scores;
  }

  function voteFor(H, id) {
    const my = mind(id);
    const scores = weigh(H, id);
    let best = null, bestScore = 0;
    for (const other in scores) {
      if (scores[other] > bestScore) { bestScore = scores[other]; best = other; }
    }
    const impostor = C.ROLES[H.roles[id] || 'crewmate'].team === 'impostor';
    /* A crew bot with nothing on anybody skips, which is the correct play and
       the one that makes the times they do vote mean something. */
    const threshold = impostor ? 18 : 30;
    if (!best || bestScore < threshold) return 'skip';
    void my;
    return best;
  }

  /* ---- talking ------------------------------------------------------------ */

  /* Prefer a phrasing nobody has just used. Three bots landing on the exact
     same sentence in a row is the fastest way to remind everyone they are
     bots. */
  const recent = [];
  function pick(list) {
    const fresh = list.filter((t) => recent.indexOf(t) < 0);
    const from = fresh.length ? fresh : list;
    const choice = from[Math.floor(Math.random() * from.length)];
    recent.push(choice);
    if (recent.length > 9) recent.shift();
    return choice;
  }
  const says = (text, claim) => (text ? { text, claim: claim || null } : null);

  function myRoomAround(my, t) {
    let best = null;
    for (const r of my.rooms) {
      if (r.t > t + 4) continue;
      if (!best || r.t > best.t) best = r;
    }
    return best ? best.room : null;
  }

  function nameOf(H, id) { return H.players[id] ? H.players[id].name : 'someone'; }

  function line(H, id) {
    const my = mind(id);
    const impostor = C.ROLES[H.roles[id] || 'crewmate'].team === 'impostor';
    const body = my.bodies[my.bodies.length - 1];
    const when = body ? body.t : clock(H);
    const scores = my.suspicion && Object.keys(my.suspicion).length ? my.suspicion : weigh(H, id);

    const top = Object.keys(scores).sort((a, b) => scores[b] - scores[a])[0];
    const accusers = Object.keys(my.accusedBy);

    /* 1. Something certain, said first and plainly. */
    for (const who in my.witnessed) {
      if (!H.players[who] || !H.players[who].alive) continue;
      if (my.spokeAbout[who]) continue;
      const saw = my.witnessed[who];
      if (impostor && C.ROLES[H.roles[who] || 'crewmate'].team === 'impostor') continue;
      my.spokeAbout[who] = true;
      if (saw.kill) {
        return says(pick([
          'I watched ' + nameOf(H, who) + ' do it.',
          'It is ' + nameOf(H, who) + '. I saw the kill.',
          nameOf(H, who) + '. I was right there when it happened.',
        ]), { kind: 'witness', about: who });
      }
      if (saw.vent) {
        return says(pick([
          nameOf(H, who) + ' came out of a vent.',
          'I saw ' + nameOf(H, who) + ' vent. That is the game.',
          'Vent. ' + nameOf(H, who) + '. I saw it with my own eyes.',
        ]), { kind: 'witness', about: who });
      }
    }

    /* 2. Being accused gets answered before anything else. */
    if (accusers.length && !my.spokeAbout.defence) {
      my.spokeAbout.defence = true;
      const room = myRoomAround(my, when) || 'the corridor';
      const witness = my.sightings.filter((s) =>
        Math.abs(s.t - when) < 10 && H.players[s.who] && H.players[s.who].alive)[0];
      if (witness) {
        return says(pick([
          'Not me. I was in ' + room + ' with ' + nameOf(H, witness.who) + '.',
          'I was in ' + room + '. ' + nameOf(H, witness.who) + ' was with me, ask them.',
        ]));
      }
      return says(pick([
        'It is not me. I was in ' + room + ' the whole time.',
        'I was doing tasks in ' + room + '.',
        'Why me? I have been in ' + room + '.',
      ]));
    }

    /* 3. The finder says where. */
    if (body && body.finder === id && !my.spokeAbout.report) {
      my.spokeAbout.report = true;
      const near = my.sightings.filter((s) =>
        s.room === body.room && body.t - s.t < MURDER_WINDOW
        && H.players[s.who] && H.players[s.who].alive);
      if (near.length) {
        const suspect = near[near.length - 1].who;
        return says(nameOf(H, body.who) + ' in ' + body.room + '. '
          + nameOf(H, suspect) + ' was there.', { kind: 'accuse', about: suspect });
      }
      return says(pick([
        nameOf(H, body.who) + ' in ' + body.room + '. I saw nobody.',
        'Body in ' + body.room + '. It was cold, I was alone.',
      ]));
    }

    /* 4. An accusation, if the evidence is worth one. */
    if (top && scores[top] >= 30 && !my.spokeAbout['acc' + top]) {
      my.spokeAbout['acc' + top] = true;
      const seen = lastSeenBefore(my, top, when);
      if (seen && body) {
        const options = [
          'I saw ' + nameOf(H, top) + ' in ' + seen.room + ' just before.',
          'Where were you, ' + nameOf(H, top) + '? I saw you in ' + seen.room + '.',
          nameOf(H, top) + ' was in ' + seen.room + ' right before it happened.',
        ];
        /* Only claim two rooms are neighbours when they are two rooms. */
        if (seen.room !== body.room) {
          options.push(nameOf(H, top) + ' was in ' + seen.room + ', right by ' + body.room + '.');
        } else {
          options.push(nameOf(H, top) + ' was in ' + body.room + ' with the body.');
        }
        return says(pick(options), { kind: 'accuse', about: top });
      }
      return says(pick([
        'I have not seen ' + nameOf(H, top) + ' do a single thing.',
        nameOf(H, top) + ' has been nowhere all round.',
      ]), { kind: 'accuse', about: top });
    }

    /* 5. Otherwise, where I was. An impostor picks a room it really was in,
          before the kill -- a lie that cannot be contradicted by anybody who
          was watching, which is the only kind worth telling. */
    if (!my.spokeAbout.alibi) {
      my.spokeAbout.alibi = true;
      const room = impostor
        ? (myRoomAround(my, Math.max(0, when - 20)) || myRoomAround(my, when) || 'Storage')
        : (myRoomAround(my, when) || 'the corridor');
      const withMe = my.sightings.filter((s) =>
        Math.abs(s.t - when) < 10 && H.players[s.who] && H.players[s.who].alive);
      if (withMe.length && !impostor) {
        return says(pick([
          'I was in ' + room + ' with ' + nameOf(H, withMe[0].who) + '.',
          room + '. ' + nameOf(H, withMe[0].who) + ' can back me up.',
        ]));
      }
      return says(pick([
        'I was in ' + room + '.',
        'Tasks in ' + room + ', nothing to report.',
        'I came from ' + room + '.',
      ]));
    }

    /* 6. Filler that still carries information. */
    const others = Object.keys(scores).filter((k) => H.players[k] && H.players[k].alive);
    if (others.length && Math.random() < 0.6) {
      return says(pick([
        'Where was everyone?',
        'Anybody see ' + nameOf(H, others[Math.floor(Math.random() * others.length)]) + '?',
        'Who was with ' + nameOf(H, others[Math.floor(Math.random() * others.length)]) + '?',
        'I have nothing on anyone. Skip?',
      ]));
    }
    return null;
  }

  /* Bots talk on their own clock, spread across the discussion so it reads as
     a conversation rather than a wall of text arriving at once. */
  function speak(dt, H, say) {
    if (!H.meeting) return;
    for (const id of Object.keys(H.players)) {
      const p = H.players[id];
      if (!p || !p.bot || !p.alive) continue;
      const my = mind(id);
      if (my.nextSpeak <= 0 && my.said === 0) my.nextSpeak = 1.5 + Math.random() * 7;
      my.nextSpeak -= dt;
      if (my.nextSpeak > 0) continue;
      if (my.said >= 3) { my.nextSpeak = 999; continue; }
      my.said++;
      my.nextSpeak = 4 + Math.random() * 9;
      const said = line(H, id);
      if (!said) continue;
      say(id, said.text);
      if (said.claim) receiveClaim(H, id, said.claim);
    }
  }

  function meetingOpened(H) {
    recent.length = 0;
    for (const [, my] of minds) {
      my.nextSpeak = 0;
      my.said = 0;
      my.spokeAbout = {};
      my.testimony.length = 0;
    }
  }

  NS.minds = {
    reset, observe, witnessKill, witnessVent, noteBody, hear,
    speak, voteFor, weigh, meetingOpened,
    mindOf: (id) => minds.get(id) || null,
  };
})(window.NS);
