/* The meeting.

   Everything else in the game is a warm-up for this screen. It is also the
   part most likely to be played on a phone in a classroom with the sound off,
   so it is built around typing rather than talking: the chat is not a side
   panel you can miss, it is half the screen, and quick phrases are one tap
   because "where" and "with who" are ninety per cent of what anybody says.

   Two rules the layout exists to enforce. You cannot see who voted for whom
   until the vote closes -- only that somebody has voted -- because watching
   the tally build turns a vote into a stampede. And the dead can read
   everything and say nothing to the living, which is what stops a death from
   being the end of somebody's involvement. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const C = NS.config;
  const el = U.el;
  const W = NS.world;

  let root = null;
  let grid = null;
  let log = null;
  let timerNode = null;
  let stageNode = null;
  let headline = null;
  let composer = null;
  let myVote = null;
  let rows = new Map();
  let lastStage = '';
  let unread = 0;
  const history = [];

  let send = function () {};

  function init(opts) { send = opts.send; }

  /* ---- chat -------------------------------------------------------------- */

  const QUICK = [
    'Where?', 'With who?', 'I was doing tasks', 'Nothing to report',
    'Saw them vent', 'Body in ', 'It is not me', 'Skip',
  ];

  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function addMessage(msg) {
    history.push(msg);
    if (history.length > 120) history.shift();
    if (log) appendRow(msg);
    for (const fn of Array.from(listeners)) fn(msg);
  }

  /* One chat row, rendered the same way wherever it is shown -- the meeting
     and the ghosts' own window are the same conversation seen from different
     sides of being alive. */
  function renderRow(msg) {
    const row = el('div', { class: 'chat-row' + (msg.ghost ? ' is-ghost' : '') });
    if (msg.system) {
      row.className = 'chat-row is-system';
      row.textContent = msg.text;
      return row;
    }
    const who = el('span', { class: 'chat-who', text: msg.name });
    who.style.color = msg.ghost ? '#9d8cff' : (C.COLORS[msg.colorIdx] || C.COLORS[0]).rim;
    row.appendChild(who);
    row.appendChild(el('span', { class: 'chat-text', text: msg.text }));
    return row;
  }

  function appendRow(msg) {
    log.appendChild(renderRow(msg));
    log.scrollTop = log.scrollHeight;
  }

  function systemMessage(text) {
    addMessage({ system: true, text });
  }

  /* ---- building ---------------------------------------------------------- */

  function build() {
    root = el('div', { class: 'meeting', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Meeting' });

    headline = el('h2', { class: 'meeting-head', text: '' });
    stageNode = el('p', { class: 'meeting-stage', text: '' });
    timerNode = el('div', { class: 'meeting-timer', 'aria-live': 'off' }, [
      el('span', { class: 'meeting-timer-value', text: '0' }),
    ]);

    grid = el('div', { class: 'vote-grid' });
    log = el('div', { class: 'chat-log', 'aria-live': 'polite', 'aria-label': 'Meeting chat' });

    const input = el('input', {
      class: 'chat-input', type: 'text', maxlength: String(C.CHAT_MAX),
      placeholder: 'Say something', autocomplete: 'off',
      'aria-label': 'Message',
    });
    const form = el('form', {
      class: 'chat-form',
      onsubmit: (e) => {
        e.preventDefault();
        const text = U.cleanName(input.value, C.CHAT_MAX);
        if (!text) return;
        send('chat', { t: 'msg', text });
        input.value = '';
      },
    }, [input, el('button', { class: 'btn btn--primary chat-send', type: 'submit', text: 'Send' })]);

    const quick = el('div', { class: 'chat-quick' });
    for (const phrase of QUICK) {
      quick.appendChild(el('button', {
        class: 'chip', type: 'button', text: phrase,
        onclick: () => {
          if (phrase === 'Body in ' || phrase === 'Where?') { input.value = phrase; input.focus(); return; }
          send('chat', { t: 'msg', text: phrase });
        },
      }));
    }

    composer = el('div', { class: 'chat-compose' }, [quick, form]);

    const tabs = el('div', { class: 'meeting-tabs' }, [
      el('button', { class: 'tab is-on', type: 'button', text: 'Crew', onclick: () => setTab('crew') }),
      el('button', { class: 'tab', type: 'button', text: 'Chat', onclick: () => setTab('chat') }),
    ]);

    const left = el('section', { class: 'meeting-left' }, [grid]);
    const right = el('section', { class: 'meeting-right' }, [log, composer]);

    root.appendChild(el('header', { class: 'meeting-bar' }, [
      el('div', {}, [headline, stageNode]),
      timerNode,
    ]));
    root.appendChild(tabs);
    root.appendChild(el('div', { class: 'meeting-body' }, [left, right]));
    document.body.appendChild(root);
    root.dataset.tab = 'crew';
    return root;
  }

  function setTab(which) {
    if (!root) return;
    root.dataset.tab = which;
    U.$$('.meeting-tabs .tab', root).forEach((t, i) => {
      t.classList.toggle('is-on', (i === 0) === (which === 'crew'));
    });
    if (which === 'chat') {
      unread = 0;
      U.$$('.meeting-tabs .tab')[1].textContent = 'Chat';
      log.scrollTop = log.scrollHeight;
    }
  }

  /* ---- the roster -------------------------------------------------------- */

  function rebuildGrid(state) {
    grid.textContent = '';
    rows.clear();
    const players = Array.from(W.players.values())
      .filter((p) => p.connected)
      .sort((a, b) => (a.alive === b.alive ? a.name.localeCompare(b.name) : (a.alive ? -1 : 1)));

    for (const p of players) {
      const row = el('div', { class: 'vote-row' + (p.alive ? '' : ' is-dead') });
      row.appendChild(NS.bits.avatar(p.shiftIdx >= 0 ? p.shiftIdx : p.colorIdx, p.hatIdx, 52,
        { ghost: !p.alive }));
      const name = el('div', { class: 'vote-name' }, [
        el('strong', { text: p.name }),
        el('span', { class: 'vote-sub', text: p.isMe ? 'You' : (p.alive ? '' : 'Dead') }),
      ]);
      row.appendChild(name);
      const tokens = el('div', { class: 'vote-tokens' });
      row.appendChild(tokens);
      const button = el('button', {
        class: 'vote-btn', type: 'button', 'aria-label': 'Vote for ' + p.name,
        disabled: true, onclick: () => castVote(p.id),
      }, [NS.bits.icon('close', 18)]);
      row.appendChild(button);
      grid.appendChild(row);
      rows.set(p.id, { row, tokens, button, player: p });
    }

    const skipRow = el('div', { class: 'vote-row vote-row--skip' });
    skipRow.appendChild(el('div', { class: 'skip-mark', text: 'S' }));
    skipRow.appendChild(el('div', { class: 'vote-name' }, [
      el('strong', { text: 'Skip vote' }),
      el('span', { class: 'vote-sub', text: 'Nobody is ejected' }),
    ]));
    const skipTokens = el('div', { class: 'vote-tokens' });
    skipRow.appendChild(skipTokens);
    const skipButton = el('button', {
      class: 'vote-btn', type: 'button', 'aria-label': 'Skip the vote',
      disabled: true, onclick: () => castVote('skip'),
    }, [NS.bits.icon('close', 18)]);
    skipRow.appendChild(skipButton);
    grid.appendChild(skipRow);
    rows.set('skip', { row: skipRow, tokens: skipTokens, button: skipButton });
  }

  /* A vote is sealed to the host so nobody watching the wire can read the
     room before the room can. */
  function castVote(target) {
    if (myVote) return;
    const state = W.state;
    if (!state.meeting || state.meeting.stage !== 'vote') return;
    if (!W.me || !W.me.alive || W.me.ghost) return;
    myVote = target;
    NS.audio.play('vote');
    for (const [id, row] of rows) {
      row.button.disabled = true;
      row.row.classList.toggle('is-mine', id === target);
    }
    NS.secrets.sealTo(W.hostKey, { target }).then((sealed) => {
      if (sealed) send('act', { t: 'vote', s: sealed });
      else send('act', { t: 'vote', target });
    });
  }

  /* ---- per-frame --------------------------------------------------------- */

  function update() {
    const state = W.state;
    const meeting = state.meeting;
    if (!root || !meeting) return;

    if (meeting.stage !== lastStage) {
      lastStage = meeting.stage;
      stageNode.textContent = meeting.stage === 'discuss'
        ? 'Discussion. Voting opens when the clock runs out.'
        : 'Vote now. You cannot change it.';
      root.dataset.stage = meeting.stage;
      if (meeting.stage === 'vote') NS.audio.play('alarm');
    }

    timerNode.firstChild.textContent = U.clock(meeting.time);
    timerNode.classList.toggle('is-urgent', meeting.time <= 10);

    const voted = meeting.voted || [];
    for (const [id, row] of rows) {
      if (id === 'skip') continue;
      row.row.classList.toggle('has-voted', voted.indexOf(id) >= 0);
    }

    /* A vote button that can be pressed and does nothing is worse than one
       that is plainly off, so they stay disabled until voting actually opens
       and after you have used yours. */
    const meAlive = !!(W.me && W.me.alive && !W.me.ghost);
    const open = meeting.stage === 'vote' && meAlive && !myVote;
    for (const [id, row] of rows) {
      const target = row.player;
      row.button.disabled = !open || (target && !target.alive);
    }

    const counter = U.$('.meeting-waiting', root);
    if (counter) {
      if (meeting.stage !== 'vote') {
        counter.textContent = meAlive
          ? 'Say where you were. Voting opens in ' + U.clock(meeting.time) + '.'
          : 'You are dead. You can read this, but they cannot hear you.';
      } else {
        const waiting = W.alivePlayers().filter((p) => voted.indexOf(p.id) < 0).length;
        counter.textContent = myVote
          ? 'Vote cast. ' + waiting + ' still to vote.'
          : waiting + ' still to vote.';
      }
    }
  }

  function show(state) {
    if (!root) build();
    root.hidden = false;
    document.body.classList.add('in-meeting');
    myVote = null;
    lastStage = '';
    unread = 0;
    rebuildGrid(state);

    const meeting = state.meeting;
    const by = W.players.get(meeting.by);
    if (meeting.reason === 'body') {
      const dead = meeting.bodyId ? W.players.get(meeting.bodyId) : null;
      headline.textContent = 'Dead body reported';
      systemMessage((by ? by.name : 'Someone') + ' found ' + (dead ? dead.name : 'a body') + '.');
    } else {
      headline.textContent = 'Emergency meeting';
      systemMessage((by ? by.name : 'Someone') + ' called it.');
    }
    if (!U.$('.meeting-waiting', root)) {
      root.querySelector('.meeting-left').appendChild(el('p', { class: 'meeting-waiting', text: '' }));
    }
    root.dataset.stage = state.meeting.stage;
    /* Ghosts can read but not write to the living. Disabling the box rather
       than hiding it is deliberate: you can see the conversation you are
       locked out of, which is most of what being dead is. */
    const dead = W.me && (!W.me.alive || W.me.ghost);
    composer.classList.toggle('is-locked', dead);
    const input = U.$('.chat-input', root);
    if (input) {
      input.disabled = dead;
      input.placeholder = dead ? 'The living cannot hear you' : 'Say something';
    }
    U.$$('.chat-quick .chip', root).forEach((c) => { c.disabled = dead; });
    update();
  }

  function hide() {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove('in-meeting');
  }

  function onChat(msg) {
    addMessage(msg);
    if (root && !root.hidden && root.dataset.tab !== 'chat' && window.matchMedia('(max-width: 860px)').matches) {
      unread++;
      const tab = U.$$('.meeting-tabs .tab', root)[1];
      if (tab) tab.textContent = 'Chat (' + unread + ')';
    }
    NS.audio.play('chat');
  }

  function clear() {
    history.length = 0;
    if (log) log.textContent = '';
  }

  NS.meeting = {
    init, show, hide, update, onChat, clear, systemMessage, setTab,
    subscribe, renderRow, history, send: (text) => send('chat', { t: 'msg', text }),
  };
})(window.NS);
