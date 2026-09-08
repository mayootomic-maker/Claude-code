/* The screens either side of a round: the way in, the lobby, and the way it
   ended.

   The way in is the part that decides whether a class actually plays. Three
   buttons, no account, no install, and a four-letter code somebody reads out
   loud. Practice against bots is first on the list rather than hidden at the
   bottom, because the person opening this link is on their own and one player
   staring at an empty lobby is how a game gets closed. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const M = NS.map;
  const W = NS.world;
  const el = U.el;

  let hooks = {};
  let current = null;
  let backdrop = null;
  let backdropStop = null;

  const profile = {
    name: U.cleanName(U.store.get('name', ''), C.NAME_MAX),
    colorIdx: U.clamp(U.store.get('colour', Math.floor(Math.random() * C.COLORS.length)) | 0, 0, C.COLORS.length - 1),
    hatIdx: U.clamp(U.store.get('hat', 0) | 0, 0, C.HATS.length - 1),
  };

  function saveProfile() {
    U.store.set('name', profile.name);
    U.store.set('colour', profile.colorIdx);
    U.store.set('hat', profile.hatIdx);
  }

  function init(opts) { hooks = opts; }

  /* ---- the station, drifting behind everything --------------------------- */

  /* The title sits over the real map, panned slowly. It costs one blit a
     frame and it means the first thing anybody sees is the place they are
     about to be in, rather than a logo on a gradient. */
  function startBackdrop(host) {
    const canvas = el('canvas', { class: 'backdrop', 'aria-hidden': 'true' });
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let t = 0;
    let running = true;
    function frame() {
      if (!running) return;
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#05070d';
      ctx.fillRect(0, 0, rect.width, rect.height);
      const station = NS.station.canvas;
      if (station) {
        t += 0.00022;
        const scale = Math.max(rect.width / 1500, 0.55);
        const px = (Math.sin(t) * 0.5 + 0.5) * Math.max(0, M.pixelWidth - rect.width / scale);
        const py = (Math.cos(t * 0.7) * 0.5 + 0.5) * Math.max(0, M.pixelHeight - rect.height / scale);
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.scale(scale, scale);
        const k = NS.station.scale;
        ctx.drawImage(station,
          px * k, py * k, (rect.width / scale) * k, (rect.height / scale) * k,
          0, 0, rect.width / scale, rect.height / scale);
        ctx.restore();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    return () => { running = false; canvas.remove(); };
  }

  /* ---- shared chrome ----------------------------------------------------- */

  function screen(name) {
    hideAll();
    const root = el('section', { class: 'screen screen--' + name });
    document.body.appendChild(root);
    current = root;
    return root;
  }

  function hideAll() {
    if (backdropStop) { backdropStop(); backdropStop = null; }
    if (current) { current.remove(); current = null; }
  }

  /* The character you are about to be, with the pickers under it. Changing a
     colour redraws the same drawing the world uses, so what you choose here
     is exactly what everybody sees out there. */
  function dresser(onChange) {
    const wrap = el('div', { class: 'dresser' });
    const stageBox = el('div', { class: 'dresser-stage' });
    function repaint() {
      stageBox.textContent = '';
      stageBox.appendChild(NS.bits.avatar(profile.colorIdx, profile.hatIdx, 168));
    }
    repaint();

    const colours = el('div', { class: 'swatches', role: 'group', 'aria-label': 'Colour' });
    C.COLORS.forEach((colour, i) => {
      const btn = el('button', {
        class: 'swatch', type: 'button', 'aria-label': colour.name, title: colour.name,
        'aria-pressed': String(i === profile.colorIdx),
        onclick: () => {
          profile.colorIdx = i;
          saveProfile();
          U.$$('.swatch', colours).forEach((n, k) => n.setAttribute('aria-pressed', String(k === i)));
          repaint();
          NS.audio.play('click');
          if (onChange) onChange();
        },
      });
      btn.style.setProperty('--swatch', colour.body);
      colours.appendChild(btn);
    });

    const hats = el('div', { class: 'hats', role: 'group', 'aria-label': 'Hat' });
    C.HATS.forEach((hat, i) => {
      const btn = el('button', {
        class: 'hat-btn', type: 'button', title: hat.name, 'aria-label': hat.name,
        'aria-pressed': String(i === profile.hatIdx),
        onclick: () => {
          profile.hatIdx = i;
          saveProfile();
          U.$$('.hat-btn', hats).forEach((n, k) => n.setAttribute('aria-pressed', String(k === i)));
          repaint();
          NS.audio.play('click');
          if (onChange) onChange();
        },
      });
      btn.appendChild(NS.bits.avatar(profile.colorIdx, i, 44, { class: 'hat-preview' }));
      hats.appendChild(btn);
    });

    wrap.appendChild(stageBox);
    wrap.appendChild(colours);
    wrap.appendChild(el('p', { class: 'dresser-label', text: 'Hat' }));
    wrap.appendChild(hats);
    wrap.__repaint = repaint;
    return wrap;
  }

  /* ---- title ------------------------------------------------------------- */

  function showTitle(message) {
    const root = screen('title');
    backdropStop = startBackdrop(root);

    const nameInput = el('input', {
      class: 'field', type: 'text', maxlength: String(C.NAME_MAX),
      placeholder: 'Your name', value: profile.name, 'aria-label': 'Your name',
      autocomplete: 'nickname', autocapitalize: 'words',
      oninput: (e) => { profile.name = U.cleanName(e.target.value, C.NAME_MAX); saveProfile(); },
    });

    const codeInput = el('input', {
      class: 'field field--code', type: 'text', maxlength: '4',
      placeholder: 'CODE', 'aria-label': 'Room code',
      autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      oninput: (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); },
    });

    function needName() {
      if (profile.name) return false;
      nameInput.focus();
      nameInput.classList.add('is-wrong');
      setTimeout(() => nameInput.classList.remove('is-wrong'), 500);
      NS.bits.toast('Put a name in first, so people know who you are.', 'warn');
      return true;
    }

    const online = NS.link.roomAvailable() || NS.link.mqttAvailable();

    const actions = el('div', { class: 'title-actions' }, [
      el('button', {
        class: 'btn btn--primary btn--big', type: 'button',
        onclick: () => { if (!needName()) hooks.onHost(profile); },
        disabled: !online,
      }, [el('strong', { text: 'Start a game' }), el('span', { text: 'You get a code to read out' })]),
      el('div', { class: 'join-row' }, [
        codeInput,
        el('button', {
          class: 'btn btn--ghost', type: 'button', text: 'Join',
          disabled: !online,
          onclick: () => {
            if (needName()) return;
            const code = codeInput.value.trim().toUpperCase();
            if (code.length !== 4) {
              codeInput.classList.add('is-wrong');
              setTimeout(() => codeInput.classList.remove('is-wrong'), 500);
              NS.bits.toast('A code is four characters.', 'warn');
              return;
            }
            hooks.onJoin(profile, code);
          },
        }),
      ]),
      el('button', {
        class: 'btn btn--quiet', type: 'button',
        onclick: () => { if (!needName()) hooks.onSolo(profile); },
      }, [el('strong', { text: 'Practice with bots' }), el('span', { text: 'On your own, right now' })]),
    ]);

    const left = el('div', { class: 'title-left' }, [
      el('p', { class: 'eyebrow', text: 'Aurora-7 research station' }),
      el('h1', { class: 'wordmark' }, [
        el('span', { text: 'NIGHT' }), el('em', { text: 'SHIFT' }),
      ]),
      el('p', { class: 'tagline', text: 'Fourteen people, a station that is falling apart, and at least one of them wants it to.' }),
      el('div', { class: 'field-row' }, [nameInput]),
      actions,
      el('p', { class: 'title-note', text: transportNote() }),
      el('button', { class: 'link-btn', type: 'button', text: 'How it works', onclick: showHelp }),
    ]);

    root.appendChild(el('div', { class: 'title-grid' }, [left, dresser()]));
    if (message) NS.bits.toast(message, 'warn', 6);
  }

  function transportNote() {
    if (location.hash === '#local') {
      return 'Same-computer mode: this page talks to its own other tabs and nothing else. '
        + 'Open it twice, host in one and join in the other. Drop the #local off the address '
        + 'to play with other devices.';
    }
    if (NS.link.roomAvailable()) {
      return 'Everyone opens this same link and types the code. It works for people signed in to '
        + 'the same organisation as whoever published it; anyone else should use the downloadable file.';
    }
    if (NS.link.mqttAvailable()) {
      return 'Everyone opens this same file and types the code. It goes over a free public message '
        + 'broker, so there is nothing to install and no account -- and nothing on it is private.';
    }
    return 'This browser cannot open a connection, so only practice mode will work.';
  }

  function showHelp() {
    const root = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const box = el('div', { class: 'sheet-box sheet-box--wide' });
    box.appendChild(el('header', { class: 'sheet-head' }, [
      el('h3', { text: 'How it works' }),
      el('button', { class: 'tool', type: 'button', 'aria-label': 'Close', onclick: () => root.remove() },
        [NS.bits.icon('close', 20)]),
    ]));
    const body = el('div', { class: 'prose' });
    [
      ['The crew', 'Everyone gets a list of jobs around the station. Finish all of them and the crew wins. '
        + 'Your jobs are marked with a ring on the floor and listed under Tasks.'],
      ['The impostors', 'One to three of you are lying. You can kill, climb through the vents, and break '
        + 'the station to move people around. You have a fake task list to stand at.'],
      ['Meetings', 'Find a body and report it, or press the button in the Cafeteria. Everyone argues in '
        + 'the chat, then votes. The most voted is thrown out of the airlock.'],
      ['Being dead', 'You keep playing. Ghosts walk through walls, finish the tasks that still count, '
        + 'and can read everything -- but the living cannot hear you.'],
      ['Controls', 'WASD or the arrows to walk, E to use, Q to kill, R to report, F for your role ability, '
        + 'M for the map. On a phone, touch the left half to walk and use the buttons on the right.'],
    ].forEach(([title, text]) => {
      body.appendChild(el('h4', { text: title }));
      body.appendChild(el('p', { text }));
    });
    /* Built from the role table rather than written out, so a role that is
       added, renamed or reworded can never quietly disagree with the page that
       explains it. */
    body.appendChild(el('h4', { text: 'The roles' }));
    body.appendChild(el('p', {
      text: 'Which of these turn up is set in the lobby. Every one of them is off or on '
        + 'with a chance, so a class can build the game it wants.',
    }));
    const roles = el('div', { class: 'help-roles' });
    for (const key of ['crewmate'].concat(C.CREW_ROLES, ['impostor'], C.IMPOSTOR_ROLES, ['jester'])) {
      const def = C.ROLES[key];
      if (!def) continue;
      roles.appendChild(el('div', { class: 'help-role' }, [
        el('div', { class: 'help-role-head' }, [
          el('strong', { text: def.name }),
          el('span', {
            class: 'role-team role-team--' + def.team,
            text: def.team === 'impostor' ? 'Impostor' : def.team === 'jester' ? 'Neutral' : 'Crew',
          }),
        ]),
        el('p', { text: def.blurb }),
      ]));
    }
    body.appendChild(roles);

    box.appendChild(body);
    root.appendChild(box);
    root.addEventListener('click', (e) => { if (e.target === root) root.remove(); });
    document.body.appendChild(root);
  }

  /* ---- lobby ------------------------------------------------------------- */

  let lobbyNodes = null;

  function showLobby(info) {
    const root = screen('lobby');
    backdropStop = startBackdrop(root);

    const code = el('button', {
      class: 'code', type: 'button', title: 'Copy the code',
      onclick: () => {
        const text = info.code;
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(
          () => NS.bits.toast('Code copied.', 'good'),
          () => NS.bits.toast('Copy did not work -- read it out instead.', 'warn'));
        else NS.bits.toast('Read it out: ' + text, 'info');
      },
    }, [el('span', { class: 'code-label', text: 'Room code' }), el('strong', { text: info.code })]);

    const roster = el('div', { class: 'roster' });
    const status = el('p', { class: 'lobby-status', text: '' });
    const settingsHost = el('div', { class: 'settings' });

    const startBtn = el('button', {
      class: 'btn btn--primary btn--big', type: 'button', text: 'Start the round',
      onclick: () => hooks.onStart(),
    });
    const readyBtn = el('button', {
      class: 'btn btn--primary btn--big', type: 'button', text: 'Ready',
      onclick: () => hooks.onReady(),
    });
    const botRow = el('div', { class: 'bot-row' }, [
      el('span', { class: 'bot-label', text: 'Practice bots' }),
      el('button', { class: 'btn btn--ghost btn--tight', type: 'button', text: '-', 'aria-label': 'One fewer bot', onclick: () => hooks.onBots(-1) }),
      el('strong', { class: 'bot-count', text: '0' }),
      el('button', { class: 'btn btn--ghost btn--tight', type: 'button', text: '+', 'aria-label': 'One more bot', onclick: () => hooks.onBots(1) }),
    ]);

    const leave = el('div', { class: 'lobby-links' }, [
      el('button', { class: 'link-btn', type: 'button', text: 'How it works', onclick: showHelp }),
      el('button', { class: 'link-btn', type: 'button', text: 'Leave', onclick: () => hooks.onLeave() }),
    ]);

    const panel = el('div', { class: 'lobby-panel' }, [
      code,
      el('p', { class: 'lobby-hint', text: 'Everyone opens the same page and types this in.' }),
      status,
      botRow,
      el('div', { class: 'lobby-buttons' }, [startBtn, readyBtn]),
      leave,
    ]);

    root.appendChild(el('div', { class: 'lobby-grid' }, [
      el('div', { class: 'lobby-left' }, [
        el('h2', { class: 'lobby-title', text: 'Lobby' }),
        roster,
      ]),
      panel,
      el('div', { class: 'lobby-settings' }, [
        el('h3', { text: 'Settings' }),
        settingsHost,
      ]),
    ]));

    lobbyNodes = { roster, status, settingsHost, startBtn, readyBtn, botRow, code };
    rosterSignature = '';
    return lobbyNodes;
  }

  let rosterSignature = '';

  function updateLobby(info) {
    if (!lobbyNodes) return;
    const { roster, status, startBtn, readyBtn, botRow } = lobbyNodes;
    const players = info.players || [];

    /* The roster is redrawn only when it actually changed. This runs several
       times a second so the start button can never be left stale, and
       rebuilding fourteen canvas portraits at that rate would flicker. */
    const signature = players.map((p) =>
      p.name + p.colorIdx + p.hatIdx + (p.ready ? 'r' : '') + (p.bot ? 'b' : '') + (p.isHost ? 'h' : '')
    ).join('|');
    if (signature !== rosterSignature) {
      rosterSignature = signature;
      renderRoster(roster, players);
    }

    const real = players.filter((p) => !p.bot).length;
    status.textContent = players.length + ' in the lobby'
      + (players.length - real > 0 ? ' (' + (players.length - real) + ' bots)' : '')
      + (info.connection ? ' - ' + info.connection : '');

    startBtn.hidden = !info.isHost;
    readyBtn.hidden = !!info.isHost;
    botRow.hidden = !info.isHost;
    botRow.querySelector('.bot-count').textContent = String(info.bots || 0);
    if (info.isHost) {
      startBtn.disabled = !!info.blocked;
      startBtn.textContent = info.blocked || 'Start the round';
    } else {
      readyBtn.classList.toggle('is-on', !!info.ready);
      readyBtn.textContent = info.ready ? 'Ready' : 'Ready up';
    }
  }

  function renderRoster(roster, players) {
    roster.textContent = '';
    for (const p of players) {
      const card = el('div', { class: 'roster-card' + (p.ready ? ' is-ready' : '') + (p.bot ? ' is-bot' : '') });
      card.appendChild(NS.bits.avatar(p.colorIdx, p.hatIdx, 76));
      card.appendChild(el('strong', { text: p.name }));
      card.appendChild(el('span', { class: 'roster-tag', text: p.isHost ? 'Host' : (p.bot ? 'Bot' : (p.ready ? 'Ready' : '')) }));
      roster.appendChild(card);
    }
    for (let i = players.length; i < C.MAX_PLAYERS; i++) {
      roster.appendChild(el('div', { class: 'roster-card is-empty' }, [el('span', { text: '' })]));
    }
  }

  /* Settings are generated from the table in core/config.js, so a new dial
     appears here, travels to the guests and is clamped on arrival without
     anybody editing this file. */
  function buildSettings(settings, isHost, onChange) {
    if (!lobbyNodes) return;
    const host = lobbyNodes.settingsHost;
    host.textContent = '';
    for (const spec of C.SETTINGS) {
      const row = el('div', { class: 'setting' });
      row.appendChild(el('label', { class: 'setting-name', text: spec.name }));
      const value = settings[spec.key];
      let control;
      if (spec.kind === 'bool') {
        control = el('button', {
          class: 'toggle' + (value ? ' is-on' : ''), type: 'button',
          role: 'switch', 'aria-checked': String(!!value),
          text: value ? 'On' : 'Off',
          onclick: () => onChange(spec.key, !settings[spec.key]),
        });
      } else if (spec.kind === 'choice') {
        control = el('div', { class: 'segments' });
        for (const option of spec.options) {
          control.appendChild(el('button', {
            class: 'segment' + (option === value ? ' is-on' : ''), type: 'button', text: option,
            onclick: () => onChange(spec.key, option),
          }));
        }
      } else {
        const out = el('output', { class: 'setting-value', text: value + (spec.unit || '') });
        control = el('div', { class: 'slider-row' }, [
          el('input', {
            class: 'slider', type: 'range',
            min: String(spec.min), max: String(spec.max),
            step: String(spec.step || 1), value: String(value),
            'aria-label': spec.name,
            oninput: (e) => {
              out.textContent = e.target.value + (spec.unit || '');
              onChange(spec.key, Number(e.target.value));
            },
          }),
          out,
        ]);
      }
      row.appendChild(control);
      if (spec.hint) row.appendChild(el('p', { class: 'setting-hint', text: spec.hint }));
      if (!isHost) row.classList.add('is-locked');
      U.$$('button, input', row).forEach((n) => { n.disabled = !isHost; });
      host.appendChild(row);
    }

    const roles = el('div', { class: 'roles' });
    roles.appendChild(el('h4', { text: 'Roles' }));
    roles.appendChild(el('p', { class: 'setting-hint', text: 'The chance each one turns up in a round. Off means never.' }));
    for (const key of C.ROLE_SETTINGS) {
      const def = C.ROLES[key];
      const chance = settings.roles[key] || 0;
      const out = el('output', { class: 'setting-value', text: chance ? chance + '%' : 'Off' });
      const row = el('div', { class: 'setting setting--role' }, [
        el('div', { class: 'role-head' }, [
          el('strong', { text: def.name }),
          el('span', { class: 'role-team role-team--' + def.team, text: def.team === 'impostor' ? 'Impostor' : def.team === 'jester' ? 'Neutral' : 'Crew' }),
        ]),
        el('p', { class: 'setting-hint', text: def.blurb }),
        el('div', { class: 'slider-row' }, [
          el('input', {
            class: 'slider', type: 'range', min: '0', max: '100', step: '5', value: String(chance),
            'aria-label': def.name + ' chance',
            oninput: (e) => {
              out.textContent = Number(e.target.value) ? e.target.value + '%' : 'Off';
              onChange('role:' + key, Number(e.target.value));
            },
          }),
          out,
        ]),
      ]);
      if (!isHost) U.$$('input', row).forEach((n) => { n.disabled = true; });
      roles.appendChild(row);
    }
    host.appendChild(roles);
  }

  /* ---- the end ----------------------------------------------------------- */

  function showEnd(result, players, isHost) {
    const root = screen('end');
    backdropStop = startBackdrop(root);
    root.dataset.team = result.team;

    const title = result.team === 'crew' ? 'Crew wins'
      : result.team === 'impostor' ? 'Impostors win' : 'The jester wins';

    const grid = el('div', { class: 'end-roles' });
    for (const p of players) {
      const def = C.ROLES[p.role] || C.ROLES.crewmate;
      grid.appendChild(el('div', { class: 'end-card end-card--' + def.team }, [
        NS.bits.avatar(p.colorIdx, p.hatIdx, 68, { ghost: !p.alive }),
        el('strong', { text: p.name }),
        el('span', { class: 'end-role', text: def.name }),
      ]));
    }

    root.appendChild(el('div', { class: 'end-inner' }, [
      el('p', { class: 'eyebrow', text: 'Round over' }),
      el('h1', { class: 'end-title', text: title }),
      el('p', { class: 'end-reason', text: result.reason }),
      grid,
      recap(result.log),
      el('div', { class: 'end-buttons' }, [
        isHost
          ? el('button', { class: 'btn btn--primary btn--big', type: 'button', text: 'Back to the lobby', onclick: () => hooks.onPlayAgain() })
          : el('p', { class: 'end-wait', text: 'Waiting for the host to start another.' }),
        el('button', { class: 'link-btn', type: 'button', text: 'Leave', onclick: () => hooks.onLeave() }),
      ]),
    ]));
    NS.audio.play(result.team === 'crew' ? 'win' : 'lose');
  }

  /* What actually happened, in order. Everybody spent the round arguing from
     two-second glimpses; this is the only moment anyone sees the whole thing,
     and watching a class read it is most of the fun of losing. */
  /* Always m:ss in the timeline. `clock` drops the minutes under sixty
     seconds, which is right on a countdown and wrong in a column where "15"
     sits above "1:05". */
  const stamp = (seconds) => Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');

  function recap(log) {
    if (!log || !log.length) return null;
    const list = el('ol', { class: 'recap' });
    for (const entry of log) {
      let text = '';
      if (entry.k === 'kill') {
        text = entry.self
          ? entry.who + ' shot the wrong person and died for it, in ' + entry.where
          : (entry.by ? entry.by + ' killed ' + entry.who + ' in ' + entry.where
            : entry.who + ' died in ' + entry.where);
      } else if (entry.k === 'meeting') {
        text = entry.reason === 'body'
          ? (entry.by || 'Somebody') + ' reported ' + (entry.who || 'a body')
          : (entry.by || 'Somebody') + ' called an emergency meeting';
      } else if (entry.k === 'eject') {
        text = entry.who
          ? entry.who + ' was thrown out - ' + (entry.impostor ? 'an impostor' : 'not an impostor')
          : (entry.tie ? 'The vote tied. Nobody went out' : 'The crew skipped');
      } else if (entry.k === 'sabotage') {
        text = entry.name;
      }
      if (!text) continue;
      list.appendChild(el('li', { class: 'recap-row recap-row--' + entry.k }, [
        el('span', { class: 'recap-time', text: stamp(entry.t) }),
        el('span', { class: 'recap-text', text }),
      ]));
    }
    if (!list.children.length) return null;
    return el('details', { class: 'recap-wrap' }, [
      el('summary', { text: 'What happened' }),
      list,
    ]);
  }

  NS.screens = {
    init, showTitle, showLobby, updateLobby, buildSettings, showEnd, hideAll, showHelp,
    profile,
    get current() { return current; },
  };
})(window.NS);
