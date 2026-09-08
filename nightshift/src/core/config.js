/* What the game is made of: who you can be, what you look like, and every
   dial the host is allowed to turn. */

(function (NS) {
  'use strict';

  /* Fourteen suits. Named rather than numbered, because "Ember vented" is
     something a class can shout across a room and "player 3 vented" is not.
     Picked for separation under the station's dark overlay -- each one is
     tested against the others at the vision edge, where colour is dimmest,
     and the two darkest (Ink, Slate) carry a brighter rim so they never
     disappear into the floor. */
  const COLORS = [
    { id: 'ember',  name: 'Ember',  body: '#e8563f', dark: '#8e2a1c', rim: '#ff8a6f' },
    { id: 'cobalt', name: 'Cobalt', body: '#3d6fe0', dark: '#1e3a86', rim: '#7ea3ff' },
    { id: 'moss',   name: 'Moss',   body: '#4ca85c', dark: '#245c31', rim: '#84dc92' },
    { id: 'rose',   name: 'Rose',   body: '#f18fb0', dark: '#a04a68', rim: '#ffc2d6' },
    { id: 'amber',  name: 'Amber',  body: '#f0a63c', dark: '#95591a', rim: '#ffcf83' },
    { id: 'bone',   name: 'Bone',   body: '#e8e2d4', dark: '#8d8778', rim: '#fffdf6' },
    { id: 'slate',  name: 'Slate',  body: '#5b6a83', dark: '#2b3446', rim: '#93a6c4' },
    { id: 'mint',   name: 'Mint',   body: '#63d9c0', dark: '#28796a', rim: '#a5f4e4' },
    { id: 'plum',   name: 'Plum',   body: '#8b5fbf', dark: '#4a2b6b', rim: '#bf9bec' },
    { id: 'rust',   name: 'Rust',   body: '#a35a2e', dark: '#5c3018', rim: '#d68d5c' },
    { id: 'cyan',   name: 'Cyan',   body: '#35c5e8', dark: '#15687f', rim: '#8ce4ff' },
    { id: 'lime',   name: 'Lime',   body: '#a8d84a', dark: '#5b7823', rim: '#d0f486' },
    { id: 'ink',    name: 'Ink',    body: '#2b3348', dark: '#151a26', rim: '#6d7a99' },
    { id: 'coral',  name: 'Coral',  body: '#ff7a6b', dark: '#9c3b31', rim: '#ffb0a5' },
  ];

  /* Colour is never the only thing telling two players apart. Fourteen shades
     is more than anybody with a colour vision deficiency can be asked to hold,
     and the game turns the lights off on purpose -- so each colour also has a
     shape, drawn on the body and on every portrait when the option is on. */
  const SYMBOLS = ['circle', 'square', 'triangle', 'diamond', 'star', 'cross', 'chevron',
                   'ring', 'bar', 'dots', 'hexagon', 'drop', 'arrow', 'wave'];

  const colorById = (id) => COLORS.find((c) => c.id === id) || COLORS[0];
  const colorIndex = (id) => Math.max(0, COLORS.findIndex((c) => c.id === id));

  /* Hats are drawn, not sprited -- each is a function in gfx/characters.js
     keyed by this id. Nothing here is bought or unlocked; a class getting to
     look different from each other is the whole point of cosmetics at this
     scale, and a shop would just be a thing to argue about. */
  const HATS = [
    { id: 'none',    name: 'Bare head' },
    { id: 'hardhat', name: 'Hard hat' },
    { id: 'beanie',  name: 'Beanie' },
    { id: 'headset', name: 'Headset' },
    { id: 'antenna', name: 'Antenna' },
    { id: 'crown',   name: 'Crown' },
    { id: 'flower',  name: 'Flower' },
    { id: 'cap',     name: 'Backwards cap' },
    { id: 'halo',    name: 'Halo' },
    { id: 'cone',    name: 'Traffic cone' },
    { id: 'plant',   name: 'Potted plant' },
    { id: 'band',    name: 'Headband' },
  ];

  /* Roles.

     `team` decides who you win with. `kill` is whether the kill button is
     yours. Everything else is an ability with a cooldown, and the panel that
     explains it at the start of a round is generated from `blurb` -- one
     place to write it, so the card and the help screen can never disagree. */
  const ROLES = {
    crewmate: {
      id: 'crewmate', name: 'Crewmate', team: 'crew', kill: false,
      color: '#cfd9e8',
      blurb: 'Finish your tasks. Work out who is not doing theirs.',
    },
    engineer: {
      id: 'engineer', name: 'Engineer', team: 'crew', kill: false,
      color: '#f0a63c', ability: 'vent',
      blurb: 'You can use the vents. Nobody else on your side can, so being seen in one is your problem.',
    },
    scientist: {
      id: 'scientist', name: 'Scientist', team: 'crew', kill: false,
      color: '#35c5e8', ability: 'vitals',
      blurb: 'You carry vitals with you. It runs on a battery that only recharges while you complete tasks.',
    },
    sheriff: {
      id: 'sheriff', name: 'Sheriff', team: 'crew', kill: false,
      color: '#f0a63c', ability: 'shoot',
      blurb: 'You can shoot once the cooldown is up. If you shoot a crewmate, you die instead.',
    },
    medic: {
      id: 'medic', name: 'Medic', team: 'crew', kill: false,
      color: '#63d9c0', ability: 'shield',
      blurb: 'Shield one player for the whole round. The next attempt on their life fails, and they feel it.',
    },
    detective: {
      id: 'detective', name: 'Detective', team: 'crew', kill: false,
      color: '#8b5fbf', ability: 'trail',
      blurb: 'Bodies leave a trail. Stand over one and you can read which way the killer went.',
    },
    impostor: {
      id: 'impostor', name: 'Impostor', team: 'impostor', kill: true,
      color: '#ff3f5b',
      blurb: 'Sabotage the station and kill the crew. Use the vents to be somewhere you were not.',
    },
    shapeshifter: {
      id: 'shapeshifter', name: 'Shapeshifter', team: 'impostor', kill: true,
      color: '#ff3f5b', ability: 'shift',
      blurb: 'Become another crewmate for a while. Everything you do is done wearing their face.',
    },
    phantom: {
      id: 'phantom', name: 'Phantom', team: 'impostor', kill: true,
      color: '#ff3f5b', ability: 'vanish',
      blurb: 'Turn invisible for a few seconds. You cannot kill while you are gone.',
    },
    jester: {
      id: 'jester', name: 'Jester', team: 'jester', kill: false,
      color: '#f18fb0',
      blurb: 'You win by being voted out. Nothing else counts -- not tasks, not surviving.',
    },
  };

  const CREW_ROLES = ['engineer', 'scientist', 'sheriff', 'medic', 'detective'];
  const IMPOSTOR_ROLES = ['shapeshifter', 'phantom'];

  /* Every dial, with the range it is allowed to take. The lobby builds its
     own controls from this list, so adding a setting here is the only edit
     needed to make it appear, travel to the guests, and be validated on the
     way in -- a guest cannot send a kill cooldown of zero because the host
     clamps against this same table before it uses anything. */
  const SETTINGS = [
    { key: 'impostors', name: 'Impostors', kind: 'int', min: 1, max: 3, def: 1,
      hint: 'Needs at least three more crew than impostors to start.' },
    { key: 'killCooldown', name: 'Kill cooldown', kind: 'int', min: 10, max: 60, def: 25, unit: 's' },
    { key: 'killRange', name: 'Kill range', kind: 'choice', options: ['Short', 'Normal', 'Long'], def: 'Normal' },
    { key: 'playerSpeed', name: 'Player speed', kind: 'float', min: 0.6, max: 1.8, step: 0.1, def: 1.1, unit: 'x' },
    { key: 'crewVision', name: 'Crew vision', kind: 'float', min: 0.4, max: 2, step: 0.1, def: 1, unit: 'x' },
    { key: 'impostorVision', name: 'Impostor vision', kind: 'float', min: 0.8, max: 3, step: 0.1, def: 1.4, unit: 'x' },
    { key: 'emergencies', name: 'Emergency meetings', kind: 'int', min: 0, max: 5, def: 1, hint: 'Each, for the whole round.' },
    { key: 'emergencyCooldown', name: 'Emergency cooldown', kind: 'int', min: 0, max: 60, def: 20, unit: 's' },
    { key: 'discussionTime', name: 'Discussion time', kind: 'int', min: 0, max: 120, def: 25, unit: 's' },
    { key: 'votingTime', name: 'Voting time', kind: 'int', min: 20, max: 300, def: 90, unit: 's' },
    { key: 'commonTasks', name: 'Common tasks', kind: 'int', min: 0, max: 2, def: 1,
      hint: 'The same task for everyone -- the one a liar has to fake in front of you.' },
    { key: 'shortTasks', name: 'Short tasks', kind: 'int', min: 1, max: 6, def: 3 },
    { key: 'longTasks', name: 'Long tasks', kind: 'int', min: 0, max: 4, def: 1 },
    { key: 'confirmEjects', name: 'Confirm ejects', kind: 'bool', def: true,
      hint: 'Announce whether the ejected player was an impostor.' },
    { key: 'anonymousVotes', name: 'Anonymous votes', kind: 'bool', def: false },
    { key: 'visualTasks', name: 'Visual tasks', kind: 'bool', def: true,
      hint: 'Some tasks show an animation others can watch, which clears you.' },
    { key: 'taskBar', name: 'Task bar', kind: 'choice', options: ['Always', 'Meetings', 'Never'], def: 'Always' },
    { key: 'ghostsDoTasks', name: 'Ghosts finish tasks', kind: 'bool', def: true },
  ];

  /* Roles are toggled separately from the numeric dials: each is off, or on
     with a share of the round it turns up in. */
  const ROLE_SETTINGS = CREW_ROLES.concat(IMPOSTOR_ROLES).concat(['jester']);

  function defaults() {
    const out = {};
    for (const s of SETTINGS) out[s.key] = s.def;
    out.roles = {};
    for (const r of ROLE_SETTINGS) out.roles[r] = r === 'jester' ? 0 : (r === 'engineer' ? 40 : 25);
    return out;
  }

  /* Clamp anything that arrived over the wire back into the table above. The
     host settings travel to every guest and a guest draws its own lobby from
     them, so a malformed one must not be able to produce a NaN countdown. */
  function sanitise(raw) {
    const out = defaults();
    if (!raw || typeof raw !== 'object') return out;
    for (const s of SETTINGS) {
      const v = raw[s.key];
      if (v === undefined) continue;
      if (s.kind === 'bool') out[s.key] = !!v;
      else if (s.kind === 'choice') out[s.key] = s.options.indexOf(v) >= 0 ? v : s.def;
      else if (s.kind === 'int') out[s.key] = Math.round(Math.min(s.max, Math.max(s.min, Number(v) || 0)));
      else out[s.key] = Math.min(s.max, Math.max(s.min, Number(v) || 0));
    }
    if (raw.roles && typeof raw.roles === 'object') {
      for (const r of ROLE_SETTINGS) {
        const v = Number(raw.roles[r]);
        out.roles[r] = Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 0;
      }
    }
    return out;
  }

  const KILL_RANGE = { Short: 78, Normal: 108, Long: 152 };

  NS.config = {
    COLORS, SYMBOLS, colorById, colorIndex, HATS, ROLES, CREW_ROLES, IMPOSTOR_ROLES,
    SETTINGS, ROLE_SETTINGS, defaults, sanitise, KILL_RANGE,
    MAX_PLAYERS: 14,
    MIN_PLAYERS: 4,
    NAME_MAX: 12,
    CHAT_MAX: 120,
  };
})(window.NS);
