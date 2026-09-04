/* Everything that happens away from a table: the briefing, the lift, the back
   office, the nightly reckoning and the three ways this ends. */

(function (global) {
  'use strict';

  const C = GWConfig;
  let shell = null;
  let root = null;
  let current = null;

  function init(s) {
    shell = s;
    root = shell.el.screens;
  }

  const isOpen = () => !!current;

  /* The introduction, done by hand.

     A peer connection cannot start itself: something has to carry the first
     description across. With no server, that something is the two of you. The
     host makes a code, the guest pastes it and makes one back, the host pastes
     that, and the browsers take it from there.

     Every step says what it is waiting for. A silent box you are meant to paste
     into is how this feature usually fails. */
  function peerFlow(stage, asHost, name) {
    const link = shell.connect('peer', { host: asHost, name });
    if (!link) {
      stage.innerHTML = '<p class="modrow__desc">WebRTC is not available here.</p>';
      return;
    }
    const box = (label, id, ro) => '<label class="field"><span>' + label + '</span>'
      + '<textarea id="' + id + '" rows="3"' + (ro ? ' readonly' : '') + '></textarea></label>';

    if (asHost) {
      stage.innerHTML = '<div class="netflow"><p class="modrow__desc">Making your code\u2026</p></div>';
      link.createOffer().then((offer) => {
        stage.innerHTML = '<div class="netflow">'
          + '<p class="modrow__desc">1. Send this code to whoever is joining.</p>'
          + box('Your code', 'netOffer', true)
          + '<p class="modrow__desc">2. Paste the code they send back.</p>'
          + box('Their reply', 'netAnswer', false)
          + '<div class="sheet__actions"><button class="btn btn--primary" data-accept>Connect</button>'
          + '<span class="modrow__desc" id="netStatus"></span></div></div>';
        stage.querySelector('#netOffer').value = offer;
        stage.querySelector('#netOffer').select();
        stage.querySelector('[data-accept]').addEventListener('click', () => {
          const status = stage.querySelector('#netStatus');
          status.textContent = 'Connecting\u2026';
          link.accept(stage.querySelector('#netAnswer').value)
            .then(() => waitForOpen(link, status))
            .catch((err) => { status.textContent = 'That code did not read: ' + err.message; });
        });
      });
      return;
    }

    stage.innerHTML = '<div class="netflow">'
      + '<p class="modrow__desc">1. Paste the code the host sent you.</p>'
      + box('Their code', 'netOffer', false)
      + '<div class="sheet__actions"><button class="btn btn--primary" data-answer>Make my reply</button>'
      + '<span class="modrow__desc" id="netStatus"></span></div>'
      + '<div id="netReply"></div></div>';
    stage.querySelector('[data-answer]').addEventListener('click', () => {
      const status = stage.querySelector('#netStatus');
      status.textContent = 'Working\u2026';
      link.answerOffer(stage.querySelector('#netOffer').value).then((answer) => {
        status.textContent = '';
        const reply = stage.querySelector('#netReply');
        reply.innerHTML = '<p class="modrow__desc">2. Send this back to the host. '
          + 'You are connected once they paste it.</p>'
          + '<label class="field"><span>Your reply</span>'
          + '<textarea id="netAnswer" rows="3" readonly></textarea></label>'
          + '<p class="modrow__desc" id="netStatus2"></p>';
        reply.querySelector('#netAnswer').value = answer;
        reply.querySelector('#netAnswer').select();
        waitForOpen(link, reply.querySelector('#netStatus2'));
      }).catch((err) => { status.textContent = 'That code did not read: ' + err.message; });
    });
  }

  /* Say when it actually connects, and say when it does not. A connection that
     silently never opens is the single most common way this goes wrong. */
  function waitForOpen(link, status) {
    const started = Date.now();
    const poll = setInterval(() => {
      if (link.ready) {
        clearInterval(poll);
        status.textContent = 'Connected.';
        show('table');
      } else if (Date.now() - started > 25000) {
        clearInterval(poll);
        status.textContent = 'No connection after twenty-five seconds. A network that blocks '
          + 'peer-to-peer traffic will do this; the same-computer option always works.';
      }
    }, 400);
  }

  const swatch = (c) => '#' + (typeof c === 'number'
    ? c.toString(16).padStart(6, '0') : String(c).replace('#', ''));

  /* --- the public list -----------------------------------------------------

     One browser for the whole module, not one per redraw. The lobby panel
     redraws every time the list changes, which with four lobbies announcing
     every three seconds is often; opening a fresh broker connection each time
     would be a connection storm against somebody else's free broker. */
  let lobbyWatch = null;

  function watchLobbies(onList, onStatus, onError) {
    if (lobbyWatch) {
      lobbyWatch.sink = { onList, onStatus, onError };
      onList(lobbyWatch.browser.list());
      if (lobbyWatch.status) onStatus(lobbyWatch.status);
      return;
    }
    const w = { sink: { onList, onStatus, onError }, status: '', browser: null };
    lobbyWatch = w;
    w.browser = GWLink.browseLobbies({
      onList: (l) => w.sink.onList && w.sink.onList(l),
      onStatus: (t) => { w.status = t; if (w.sink.onStatus) w.sink.onStatus(t); },
      onError: (t) => { w.status = t; if (w.sink.onError) w.sink.onError(t); },
    });
  }

  function stopWatching() {
    if (!lobbyWatch) return;
    lobbyWatch.browser.stop();
    lobbyWatch = null;
  }



  /* `sticky` means Escape and a click on the backdrop will not dismiss it --
     the briefing, the nightly report and the endings all demand an answer. It
     does not mean the screen's own buttons cannot close it, which is what the
     first version did, leaving the briefing welded over the whole game. */
  function close(force) {
    if (!current) return false;
    if (current.sticky && !force) return false;
    if (current.teardown) current.teardown();
    root.innerHTML = '';
    current = null;
    return true;
  }

  /* Redraw a screen that is already open, if it is the one named. Used when
     something outside it changes what it should say -- somebody joining the
     table, for instance. Redrawing a screen that is not open would open it. */
  function refresh(name, data) {
    if (!current || current.name !== name) return;
    show(name, data || current.data || {});
  }

  function show(name, data) {
    /* A screen that started something -- a network listener, a timer -- gets to
       stop it. Without this the public-lobby browser stayed subscribed to a
       broker for the rest of the session after you closed the screen. */
    if (current && current.teardown && current.name !== name) current.teardown();
    root.innerHTML = '';
    const builder = SCREENS[name];
    if (!builder) return;
    const spec = builder(data || {});
    current = { name, sticky: !!spec.sticky, data: data || {}, teardown: spec.teardown || null };

    const screen = document.createElement('div');
    screen.className = 'screen';
    screen.setAttribute('role', 'dialog');
    screen.setAttribute('aria-modal', 'true');
    screen.setAttribute('aria-label', spec.title || name);
    const sheet = document.createElement('div');
    sheet.className = 'sheet' + (spec.width ? ' sheet--' + spec.width : '');
    sheet.innerHTML = spec.html;
    screen.appendChild(sheet);
    root.appendChild(screen);

    if (!spec.sticky) {
      screen.addEventListener('click', (e) => { if (e.target === screen) close(); });
    }
    if (spec.wire) spec.wire(sheet);
    const focusable = sheet.querySelector('button, input, [tabindex]');
    if (focusable) focusable.focus();
    trapFocus(sheet);
  }

  /* Keep tab inside an open dialog: a modal you can tab out of is a modal that
     is only visually modal. */
  function trapFocus(sheet) {
    sheet.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = sheet.querySelectorAll('button:not(:disabled), input, [tabindex]:not([tabindex="-1"])');
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
  }

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* --- screens ------------------------------------------------------------- */

  const SCREENS = {

    briefing() {
      const s = shell.store.s;
      const meta = shell.store.meta;
      const first = s.day === 1 && !meta.seenIntro;
      /* Who is actually coming in with you: real players, and nobody else.

         There is no AI crew any more, so on a solo run this list is empty and
         the whole section goes with it rather than leaving a heading over
         nothing. */
      const crew = s.friends.map((f) =>
        '<li class="mate"><span class="mate__dot" style="background:' + f.colour + ';color:' + f.colour + '"></span>'
        + '<span><span class="mate__name">' + esc(f.name) + '</span>'
        + '<span class="mate__where">at the table with you</span></span><span></span></li>').join('');
      const alone = !s.friends.length;

      return {
        sticky: true, title: 'Day ' + s.day,
        html: '<p class="sheet__kicker">' + (first ? 'The arrangement' : 'Day ' + s.day) + '</p>'
          + '<h2 class="sheet__title">' + (first ? 'Gamble With Your Friends' : 'Five more minutes') + '</h2>'
          + (first
            ? '<p class="sheet__lede">One bank account and a debt with someone who does not do '
              + 'paperwork. Five minutes inside the tower each day, and a quota to hit before the '
              + 'doors close.</p>'
              + '<p class="sheet__lede">' + (alone
                ? 'Nobody is coming with you. That is allowed, and it is not advised.'
                : 'Everything in the account is everybody’s. Anyone at the table can spend it, '
                  + 'and that is not a bug.') + '</p>'
            : '<p class="sheet__lede">The doors open for five minutes. ' + (alone
              ? 'Just you.'
              : 'Everything in the account is everybody’s, including theirs.') + '</p>')
          + '<div class="report">'
          + row('In the account', money(s.bank))
          + row('Tonight’s quota', money(s.quota), s.bank >= s.quota ? 'good' : 'bad')
          + row('Owed to the shark', money(s.debt), 'bad')
          + (s.strikes ? row('Missed quotas', s.strikes + ' of ' + C.MAX_STRIKES, 'bad') : '')
          + '</div>'
          + (alone ? ''
            : '<h3 class="rail__label" style="margin-top:1rem">Who is coming in with you</h3>'
              + '<ul class="crew">' + crew + '</ul>')
          + '<div class="sheet__actions">'
          + '<button class="btn btn--primary" data-go>Into the lobby</button>'
          + (first ? '<button class="btn btn--ghost" data-how>How this works</button>' : '')
          + '</div>',
        wire(sheet) {
          sheet.querySelector('[data-go]').addEventListener('click', () => {
            shell.store.meta.seenIntro = true;
            shell.store.saveMeta();
            shell.store.say('Day ' + shell.store.s.day + '. Quota is '
              + money(shell.store.s.quota) + '.', 'house');
            // The lobby is where a day starts: the shark, the shop and the limo.
            shell.enterLobby();
            shell.renderHud();
          });
          const how = sheet.querySelector('[data-how]');
          if (how) how.addEventListener('click', () => show('rules'));
        },
      };
    },

    rules() {
      return {
        title: 'How this works',
        html: '<p class="sheet__kicker">The arrangement</p>'
          + '<h2 class="sheet__title">How this works</h2>'
          + '<div class="report">'
          + rule('One account', 'You and your friends share it. They will spend it without asking.')
          + rule('The shout', 'When one of them is about to put everything on something, a button '
                 + 'appears. You get ' + C.SHOUTS_PER_DAY + ' shouts a day. Press Q.')
          + rule('The quota', 'Hit it before the clock runs out or the shark takes something. '
                 + 'Three misses and the run is over.')
          + rule('The debt', 'Grows ' + Math.round(C.INTEREST * 100) + '% a night. Clear it and you are out.')
          + rule('The tower', 'Four floors. Higher floors want bigger bets and pay accordingly. '
                 + 'They open as the account grows.')
          + rule('The odds', 'Printed on every table, honestly, including the house’s cut. '
                 + 'They are the numbers the game actually uses.')
          + rule('Tickets', 'Survive a quota and you earn them. They outlive the run.')
          + '</div>'
          + '<div class="sheet__actions"><button class="btn btn--primary" data-back>Understood</button></div>',
        wire(sheet) {
          sheet.querySelector('[data-back]').addEventListener('click', () => show('briefing'));
        },
      };
    },

    shark() {
      const s = shell.store.s;
      const offer = currentChallenge();
      const accepted = s.challenge && s.challenge.accepted;
      return {
        title: 'Loan shark',
        html: '<p class="sheet__kicker">The terminal</p>'
          + '<h2 class="sheet__title">Day ' + s.day + ' of ' + C.TOTAL_DAYS + '</h2>'
          + '<div class="report">'
          + row('Tonight\u2019s quota', money(s.quota), s.bank >= s.quota ? 'good' : 'bad')
          + row('In the account', money(s.bank))
          + row('Owed', money(s.debt), 'bad')
          + row('Missed quotas', s.strikes + ' of ' + C.MAX_STRIKES, s.strikes ? 'bad' : '')
          + '</div>'
          + '<h3 class="rail__label" style="margin-top:1.1rem">Tonight\u2019s challenge</h3>'
          + '<div class="ware" style="cursor:default">'
          + '<span class="ware__icon">' + (accepted ? '\u2713' : '\ud83c\udfaf') + '</span>'
          + '<span><span class="ware__name">' + esc(offer.text)
          + '<span class="ware__price">' + offer.tickets + ' tickets</span></span>'
          + '<span class="ware__desc">'
          + (accepted
            ? 'Accepted. It only pays if it is done before the doors close.'
            : 'It has to be accepted before you get in the limo. Afterwards it does not count.')
          + '</span></span></div>'
          + '<div class="sheet__actions">'
          + (accepted ? '' : '<button class="btn btn--primary" data-accept>Take it</button>')
          + '<button class="btn" data-close>Back</button></div>',
        wire(sheet) {
          const accept = sheet.querySelector('[data-accept]');
          if (accept) {
            accept.addEventListener('click', () => {
              s.challenge = { id: offer.id, accepted: true };
              shell.audio.play('cash');
              shell.store.say('Challenge accepted: ' + offer.text.toLowerCase() + '.', 'house');
              shell.store.save();
              show('shark');
            });
          }
          sheet.querySelector('[data-close]').addEventListener('click', close);
        },
      };
    },

    tower() {
      const s = shell.store.s;
      const floors = shell.store.unlockedFloors().map((entry, i) => {
        const f = entry.floor;
        const games = C.gamesOn(i, s.seed).map((id) => GWGames.get(id)).filter(Boolean);
        return '<button class="floorcard" style="--floor-accent:' + f.accent + '"'
          + (entry.open ? '' : ' disabled') + ' data-floor="' + i + '">'
          + '<span class="floorcard__no">' + i + '</span>'
          + '<span><span class="floorcard__name">' + esc(f.name) + '</span>'
          + '<p class="floorcard__blurb">' + esc(f.blurb) + '</p>'
          + '<p class="floorcard__games">' + games.map((g) => g.icon + ' ' + esc(g.name)).join(' · ')
          + ' — bets ' + money(f.minBet) + ' to ' + money(f.maxBet) + '</p></span>'
          + '<span class="floorcard__lock">' + (entry.open
            ? (i === s.floor ? 'You are here'
              : entry.visited ? 'Been there' : 'Open')
            : 'Opens on day ' + entry.opensOn) + '</span></button>';
      }).join('');

      const here = C.FLOORS[s.floor];
      const tables = C.gamesOn(s.floor, s.seed).map((id) => {
        const g = GWGames.get(id);
        if (!g) return '';
        const edge = g.paysAsRtp
          ? (100 - g.bets[0].pays * 100).toFixed(1)
          : (Math.min.apply(null, g.bets.map((b) => GWGames.edge(b))) * 100).toFixed(1);
        return '<div class="gamecard gamecard--static">'
          + '<span class="gamecard__icon">' + g.icon + '</span>'
          + '<span class="gamecard__name">' + esc(g.name) + '</span>'
          + '<span class="gamecard__edge">house takes ' + edge + '%</span></div>';
      }).join('');

      return {
        title: 'The lift', width: 'wide',
        html: '<p class="sheet__kicker">The lift</p><h2 class="sheet__title">Which floor</h2>'
          + '<p class="sheet__lead">Press for any floor the building has opened to you. '
          + 'Once you have been to one it stays on the panel for the rest of the run.</p>'
          + '<div class="floors">' + floors + '</div>'
          + '<h3 class="rail__label" style="margin:1.4rem 0 0.5rem">On ' + esc(here.name)
          + ' — walk over to one</h3>'
          + '<div class="gamegrid">' + tables + '</div>'
          + '<div class="sheet__actions"><button class="btn" data-close>Stay on this floor</button></div>',
        wire(sheet) {
          for (const b of sheet.querySelectorAll('[data-floor]')) {
            b.addEventListener('click', () => {
              const target = Number(b.dataset.floor);
              if (target === shell.store.s.floor) { close(); return; }
              shell.enterFloor(target);
            });
          }
          sheet.querySelector('[data-close]').addEventListener('click', close);
        },
      };
    },

    shop(data) {
      const tab = data.tab || 'items';
      const s = shell.store.s;
      const meta = shell.store.meta;
      let body = '';

      if (tab === 'items') {
        /* Grouped by shelf, cheapest first, with what a thing does to the odds
           printed as a number rather than left in the prose. A shopper wants
           to know two things -- can I afford it and what does it change -- and
           the flat grid answered neither without reading twenty-four
           paragraphs. */
        const SHELVES = [
          { id: 'kit', title: 'Kit',
            note: 'Moves the odds on one machine. This is what a run is built on: '
                + 'every table here takes a cut, and kit is the only thing that '
                + 'takes it back.' },
          { id: 'angle', title: 'Angles',
            note: 'Changes a rule rather than a payout — the clock, the debt, what '
                + 'the pit notices, what you get told.' },
          { id: 'risk', title: 'Bad Ideas',
            note: 'It says on the label.' },
        ];
        const owned = C.ITEMS.filter((i) => shell.store.has(i.id)
          || (s.pendingItems || []).indexOf(i.id) >= 0).length;

        /* Which machines are actually out tonight.

           Floors deal a hand from a pool, so kit for a machine that is not
           standing tonight buys nothing tonight -- and with twelve pieces of
           kit and five machines dealt, buying cheapest-first is now a way to
           spend a bank on tables you will not see. The shop has to say which
           is which, or it is asking for a decision it withheld the
           information for. */
        const open = shell.store.unlockedFloors().filter((f) => f.open);
        const goingTo = open.length ? open[open.length - 1].index : 0;
        const tonight = new Set(C.gamesOn(goingTo, s.seed));
        const floorName = (C.FLOORS[goingTo] || {}).name || '';

        body = '<p class="sheet__lead">You are carrying ' + owned + ' of '
          + C.ITEMS.length + '. Anything bought goes on the shelf by the door — '
          + 'you have to pick it up before you get in the limo.</p>'
          + '<p class="shelf__note">Tonight the lift goes to <b>' + esc(floorName)
          + '</b>, and what is standing on it is '
          + Array.from(tonight).map((g) => esc((GWGames.get(g) || { name: g }).name))
              .join(', ') + '. Kit for anything else will keep.</p>';

        for (const shelf of SHELVES) {
          const rows = C.ITEMS.filter((i) => (i.tier || 'angle') === shelf.id)
            .sort((a, b) => a.price - b.price)
            .map((item) => {
              const waiting = (s.pendingItems || []).indexOf(item.id) >= 0;
              const have = shell.store.has(item.id) || waiting;
              const can = !have && s.bank >= item.price;
              // What it does to the odds, from the same table the machines read.
              const effect = item.edge ? Object.keys(item.edge).map((g) => {
                const name = g === 'all' ? 'everything' : (GWGames.get(g) || { name: g }).name;
                return '+' + Math.round(item.edge[g] * 100) + '% ' + name;
              }).join(' · ') : '';
              // Whether any machine it names is out tonight.
              const useTonight = !!item.edge && Object.keys(item.edge)
                .some((g) => g === 'all' || tonight.has(g));
              return '<button class="ware' + (have ? ' is-owned' : '') + '"'
                + (can ? '' : ' disabled') + ' data-item="' + item.id + '">'
                + '<span class="ware__icon">' + item.icon + '</span>'
                + '<span><span class="ware__name">' + esc(item.name)
                + '<span class="ware__price">'
                + (waiting ? 'on the shelf' : have ? 'carrying' : money(item.price))
                + '</span></span>'
                + (effect ? '<span class="ware__effect">' + esc(effect)
                    + (useTonight ? '<b class="ware__tonight">on the floor tonight</b>' : '')
                    + '</span>' : '')
                + '<span class="ware__desc">' + esc(item.desc) + '</span></span></button>';
            }).join('');
          body += '<h3 class="shelf__title">' + shelf.title + '</h3>'
                + '<p class="shelf__note">' + esc(shelf.note) + '</p>'
                + '<div class="wares">' + rows + '</div>';
        }
      } else if (tab === 'tickets') {
        const spent = C.TICKET_SHOP.reduce((n, p) =>
          n + (meta.perks[p.id] || 0) * p.cost, 0);
        body = '<p class="sheet__lead">You have <b>' + meta.tickets + '</b> '
          + (meta.tickets === 1 ? 'ticket' : 'tickets')
          + ' and have spent ' + spent + '. Where the money goes when a run ends, '
          + 'these do not — they are the only thing in the building that survives it.</p>'
          + '<div class="wares">' + C.TICKET_SHOP.map((perk) => {
            const owned = meta.perks[perk.id] || 0;
            const maxed = (!perk.repeat && owned) || (perk.max && owned >= perk.max);
            const can = !maxed && meta.tickets >= perk.cost;
            // Where you are on a repeatable one, rather than a bare count.
            const track = perk.max
              ? Array.from({ length: perk.max }, (_, i) =>
                  '<i class="pip' + (i < owned ? ' pip--on' : '') + '"></i>').join('')
              : perk.repeat ? (owned ? '<span class="pipnum">×' + owned + '</span>' : '')
              : '<i class="pip' + (owned ? ' pip--on' : '') + '"></i>';
            return '<button class="ware' + (owned ? ' is-owned' : '') + '"'
              + (can ? '' : ' disabled') + ' data-perk="' + perk.id + '">'
              + '<span class="ware__icon">\u{1F39F}\u{FE0F}</span>'
              + '<span><span class="ware__name">' + esc(perk.name)
              + '<span class="ware__price">'
              + (maxed ? 'as far as it goes' : perk.cost + (perk.cost === 1 ? ' ticket' : ' tickets'))
              + '</span></span>'
              + (track ? '<span class="ware__track">' + track + '</span>' : '')
              + '<span class="ware__desc">' + esc(perk.desc) + '</span></span></button>';
          }).join('') + '</div>'
          + '<p class="odds__foot" style="margin-top:0.8rem">Tickets come off the quota, '
          + 'off the shark’s challenges, and off the top of the crates in the yard.</p>';
      } else {
        body = '<div class="wares">' + C.BODY_PARTS.map((part) => {
          const gone = shell.store.sold(part.id);
          return '<button class="ware' + (gone ? ' is-owned' : '') + '"'
            + (gone ? ' disabled' : '') + ' data-part="' + part.id + '">'
            + '<span class="ware__icon">' + (gone ? '🩸' : '🔪') + '</span>'
            + '<span><span class="ware__name">' + esc(part.name)
            + '<span class="ware__price">' + (gone ? 'gone' : money(part.cash) + ' + ' + part.tickets + '🎟') + '</span></span>'
            + '<span class="ware__desc">' + esc(part.cost) + '</span></span></button>';
        }).join('') + '</div>'
        + '<p class="odds__foot" style="margin-top:0.8rem">These do not grow back on their own. '
        + 'There is a ticket perk for that and it is not cheap.</p>';
      }

      const from = data.from;
      return {
        title: 'The back office', width: 'wide',
        html: '<p class="sheet__kicker">The back office</p>'
          + '<h2 class="sheet__title">Sketchy goods</h2>'
          + '<div class="shoptabs" role="tablist">'
          + tabBtn('items', tab, 'Items — ' + money(s.bank))
          + tabBtn('tickets', tab, 'Tickets — ' + meta.tickets + '🎟')
          + tabBtn('parts', tab, 'The back room')
          + '</div>' + body
          + '<div class="sheet__actions"><button class="btn" data-close>Done</button></div>',
        wire(sheet) {
          for (const b of sheet.querySelectorAll('[data-tab]')) {
            b.addEventListener('click', () => show('shop', { tab: b.dataset.tab, from }));
          }
          for (const b of sheet.querySelectorAll('[data-item]')) {
            b.addEventListener('click', () => { buyItem(b.dataset.item); show('shop', { tab: 'items', from }); });
          }
          for (const b of sheet.querySelectorAll('[data-perk]')) {
            b.addEventListener('click', () => { buyPerk(b.dataset.perk); show('shop', { tab: 'tickets', from }); });
          }
          for (const b of sheet.querySelectorAll('[data-part]')) {
            b.addEventListener('click', () => { sellPart(b.dataset.part); show('shop', { tab: 'parts', from }); });
          }
          // Opened from the nightly report, closing has to go back to it --
          // otherwise the day is settled, the clock is stopped and there is
          // nothing on screen to carry on with.
          sheet.querySelector('[data-close]').addEventListener('click',
            () => (from === 'report' ? show('report') : close()));
        },
      };
    },

    report() {
      const s = shell.store.s;
      const r = s.settlement || settle();
      const yours = s.stats.byGame;
      const played = Object.keys(yours).length;
      const canPay = s.debt > 0 && s.bank > 0;
      const owed = Math.min(s.bank, s.debt);

      return {
        sticky: true, title: 'Day ' + r.day + ' closed',
        html: '<p class="sheet__kicker">Day ' + r.day + ' · doors closed</p>'
          + '<h2 class="sheet__title">' + (r.met ? 'Quota met' : 'Quota missed') + '</h2>'
          + '<div class="report">'
          + row('In the account when the doors opened', money(r.opening))
          + row('In the account when they closed', money(r.closing))
          + (r.refund ? row('Insurance on your worst loss', '+' + money(r.refund), 'good') : '')
          + row('Quota', (r.met ? '−' : 'unpaid ') + money(r.quota), r.met ? 'good' : 'bad')
          + (r.ticketsEarned ? row('Tickets earned', '+' + r.ticketsEarned + '🎟', 'good') : '')
          + (r.challengeWon ? row('Challenge: ' + r.challengeWon.text,
              '+' + r.challengeWon.tickets + '🎟', 'good') : '')
          + (r.taken ? row('The shark takes', r.taken, 'bad') : '')
          + (r.paidOff ? row('Paid against the debt', '−' + money(r.paidOff), 'good') : '')
          + row('Interest on the debt', '+' + money(r.interest), 'bad')
          + row('Still owed', money(s.debt), s.debt > 0 ? 'bad' : 'good')
          + '<div class="reportrow reportrow--total"><span>Left in the account</span><span>'
          + money(s.bank) + '</span></div>'
          + '</div>'
          + (canPay
            ? '<h3 class="rail__label" style="margin-top:1rem">Pay the shark</h3>'
              + '<div class="chips">'
              + payBtn(Math.min(1000, owed)) + payBtn(Math.min(Math.round(s.bank / 2 / 25) * 25, owed))
              + payBtn(owed, 'Everything you can — ' + money(owed))
              + '</div>'
              + '<p class="odds__foot" style="margin-top:0.4rem">Paying it down is the only way out '
              + 'that is not a door marked staff.</p>'
            : '')
          + (played ? '<h3 class="rail__label" style="margin-top:1rem">Where it went</h3><div class="report">'
              + Object.keys(yours).map((id) => {
                const g = GWGames.get(id);
                const rec = yours[id];
                return row((g ? g.icon + ' ' + g.name : id) + ' · ' + rec.hands + ' hands',
                  (rec.net >= 0 ? '+' : '−') + money(Math.abs(rec.net)), rec.net >= 0 ? 'good' : 'bad');
              }).join('') + '</div>' : '')
          + '<div class="sheet__actions">'
          + (endingNow()
            ? '<button class="btn btn--primary" data-end="' + endingNow() + '">See how it ends</button>'
            : '<button class="btn btn--primary" data-next>Day ' + (s.day + 1) + '</button>'
              + '<button class="btn" data-shop>The back office</button>'
              + (s.day >= 5 && s.bank > 0
                ? '<button class="btn btn--danger" data-run>Skip town with ' + money(s.bank) + '</button>' : ''))
          + '</div>',
        wire(sheet) {
          for (const b of sheet.querySelectorAll('[data-pay]')) {
            b.addEventListener('click', () => {
              payDebt(Number(b.dataset.pay));
              show('report');
            });
          }
          const next = sheet.querySelector('[data-next]');
          if (next) next.addEventListener('click', () => { nextDay(); shell.enterLobby(); });
          const shopBtn = sheet.querySelector('[data-shop]');
          if (shopBtn) shopBtn.addEventListener('click', () => show('shop', { from: 'report' }));
          const end = sheet.querySelector('[data-end]');
          if (end) end.addEventListener('click', () => show('ending', { kind: end.dataset.end }));
          const run = sheet.querySelector('[data-run]');
          if (run) run.addEventListener('click', () => show('ending', { kind: 'runner' }));
        },
      };
    },

    /* Playing with other people.

       Two ways in, and they are honestly different. Another window on the same
       computer needs nothing at all -- one button and you are both in. Another
       computer needs the two of you to pass a block of text back and forth
       once, because a peer connection has to be introduced by something and
       there is no server here to do the introducing.

       Where the page is running decides whether the second one is even offered.
       Inside the artifact viewer WebRTC is not blocked, it is deleted, so the
       option says that rather than presenting a button that does nothing. */
    table() {
      const net = shell.net;
      const canPeer = GWLink.webrtcAvailable();
      const canLocal = GWLink.broadcastAvailable();
      const canOpen = GWLink.openAvailable();
      const named = (shell.store.meta.playerName || '');

      if (net) {
        const others = net.roster();
        const rows = others.length
          ? others.map((p) => '<li class="mate"><span class="mate__dot" style="background:'
              + swatch(p.colour) + '"></span><span class="mate__name">' + esc(p.name)
              + '</span></li>').join('')
          : '<li class="modrow__desc">Nobody else yet. Leave this open.</li>';
        return {
          title: net.isHost ? 'You are hosting' : 'You are at their table',
          html: '<p class="sheet__kicker">Play together</p>'
            + '<h2 class="sheet__title">'
            + (net.isHost ? 'You are hosting' : 'You are at their table') + '</h2>'
            + '<p class="sheet__lead">' + (net.isHost
              ? 'Your account is the account. Anyone who joins can spend it, which is the point.'
              : 'You are spending the host\u2019s account. So is everyone else.')
            + '</p>'
            + '<p class="modrow__desc">' + esc(net.kind === 'local'
              ? 'Connected to other windows on this computer.'
              : net.kind === 'open'
                ? 'On the public list. Anyone running this game can see this lobby and join it.'
                : 'Connected peer to peer.') + '</p>'
            + '<ul class="crew">' + rows + '</ul>'
            + '<div class="sheet__actions">'
            + '<button class="btn" data-leave>Leave the table</button>'
            + '<button class="btn btn--primary" data-close>Back to the floor</button>'
            + '</div>',
          wire(sheet) {
            sheet.querySelector('[data-leave]').addEventListener('click', () => {
              shell.disconnect();
              show('table');
            });
            sheet.querySelector('[data-close]').addEventListener('click', () => close(true));
          },
        };
      }

      return {
        title: 'Play together',
        html: '<p class="sheet__kicker">The table</p>'
          + '<h2 class="sheet__title">Play together</h2>'
          + '<p class="sheet__lead">One shared account, and other people who can reach it. '
          + 'That is the whole game, so it may as well be other real people.</p>'
          + '<label class="field"><span>Your name</span>'
          + '<input id="netName" maxlength="16" value="' + esc(named) + '" placeholder="Player"></label>'
          + '<div class="netways">'
          + '<div class="netway"><h3>Another window here</h3>'
          + '<p class="modrow__desc">' + (canLocal
              ? 'Open this page again in a second window and press this in both. No setup, no server.'
              : 'This browser does not do BroadcastChannel, so windows here cannot find each other.')
          + '</p><div class="sheet__actions">'
          + '<button class="btn btn--primary" data-local="host"' + (canLocal ? '' : ' disabled')
          + '>Host here</button>'
          + '<button class="btn" data-local="join"' + (canLocal ? '' : ' disabled')
          + '>Join here</button></div></div>'
          + '<div class="netway"><h3>Another computer</h3>'
          + '<p class="modrow__desc">' + (canPeer
              ? 'Peer to peer, with no server anywhere. You pass one block of text to each '
                + 'other to introduce the two browsers, and after that they talk directly.'
              : 'Not possible where this page is running: the viewer removes WebRTC before the '
                + 'game loads. Download the HTML file and open it from your own machine and '
                + 'this works.')
          + '</p><div class="sheet__actions">'
          + '<button class="btn btn--primary" data-peer="host"' + (canPeer ? '' : ' disabled')
          + '>Host a game</button>'
          + '<button class="btn" data-peer="join"' + (canPeer ? '' : ' disabled')
          + '>Join a game</button></div></div>'
          + '<div class="netway netway--wide"><h3>Anyone on the internet</h3>'
          + '<p class="modrow__desc">' + (canOpen
              ? 'No codes. Host one and it appears on the list below for everybody else '
                + 'running this game; join one and you are in. The list is carried by a free '
                + 'public message broker, which means it is open: anyone who finds it can read '
                + 'what is on it and walk into your lobby. That is the point, and it is also '
                + 'the whole of the security.'
              : 'This browser has no WebSocket, so the public list cannot be reached.')
          + '</p>'
          + '<div class="sheet__actions">'
          + '<button class="btn btn--primary" data-open="host"' + (canOpen ? '' : ' disabled')
          + '>Host a public lobby</button>'
          + '<button class="btn" data-open="refresh"' + (canOpen ? '' : ' disabled')
          + '>Look again</button>'
          + '<span class="modrow__desc" id="netOpenStatus"></span></div>'
          + '<ul class="lobbies" id="netOpenList"><li class="modrow__desc">'
          + (canOpen ? 'Looking\u2026' : 'Not available here.') + '</li></ul></div>'
          + '</div>'
          + '<div id="netStage"></div>',
        teardown: stopWatching,
        wire(sheet) {
          const nameOf = () => {
            const v = (sheet.querySelector('#netName').value || 'Player').trim().slice(0, 16);
            shell.store.meta.playerName = v;
            shell.store.saveMeta();
            return v;
          };
          for (const b of sheet.querySelectorAll('[data-local]')) {
            b.addEventListener('click', () => {
              shell.connect('local', { host: b.dataset.local === 'host', name: nameOf() });
              show('table');
            });
          }
          for (const b of sheet.querySelectorAll('[data-peer]')) {
            b.addEventListener('click', () => {
              peerFlow(sheet.querySelector('#netStage'), b.dataset.peer === 'host', nameOf());
            });
          }
          if (!canOpen) return;

          const listEl = sheet.querySelector('#netOpenList');
          const statusEl = sheet.querySelector('#netOpenStatus');
          const stage = sheet.querySelector('#netStage');

          const paint = (lobbies) => {
            if (!lobbies.length) {
              listEl.innerHTML = '<li class="modrow__desc">Nobody is hosting right now. '
                + 'Host one yourself and somebody may walk in.</li>';
              return;
            }
            listEl.innerHTML = lobbies.map((l) =>
              '<li class="lobby"><span class="lobby__who">' + esc(l.host) + '</span>'
              + '<span class="lobby__meta">' + l.players + (l.players === 1 ? ' player' : ' players')
              + ' \u00b7 day ' + l.day + '</span>'
              + '<button class="btn btn--small" data-join="' + esc(l.id) + '">Join</button></li>').join('');
            for (const b of listEl.querySelectorAll('[data-join]')) {
              b.addEventListener('click', () => join(b.dataset.join, b));
            }
          };

          /* Joining takes a moment -- a second connection to the broker, then the
             greeting. Say so on the button that was pressed rather than leaving
             it looking ignored, which is what an unlabelled wait always looks
             like. */
          function join(lobbyId, button) {
            button.disabled = true;
            button.textContent = 'Joining\u2026';
            stopWatching();
            const link = shell.connect('open', {
              host: false, name: nameOf(), lobbyId,
              onStatus: (t) => { statusEl.textContent = t; },
              onError: (t) => { statusEl.textContent = t; },
            });
            if (!link) { statusEl.textContent = 'Could not open a connection.'; return; }
            waitForOpen(link, statusEl);
          }

          sheet.querySelector('[data-open="host"]').addEventListener('click', (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            b.textContent = 'Opening\u2026';
            stopWatching();
            const link = shell.connect('open', {
              host: true, name: nameOf(),
              onStatus: (t) => { statusEl.textContent = t; },
              onError: (t) => { statusEl.textContent = t; },
            });
            if (!link) { statusEl.textContent = 'Could not open a connection.'; return; }
            waitForOpen(link, statusEl);
          });

          sheet.querySelector('[data-open="refresh"]').addEventListener('click', () => {
            stopWatching();
            listEl.innerHTML = '<li class="modrow__desc">Looking\u2026</li>';
            watchLobbies(paint, (t) => { statusEl.textContent = t; },
              (t) => { statusEl.textContent = t; listEl.innerHTML = '<li class="modrow__desc">'
                + esc(t) + '</li>'; });
          });

          watchLobbies(paint, (t) => { statusEl.textContent = t; },
            (t) => { statusEl.textContent = t;
              listEl.innerHTML = '<li class="modrow__desc">' + esc(t) + '</li>'; });
          if (stage) stage.dataset.ready = '1';
        },
      };
    },

    ending(data) {
      const s = shell.store.s;
      const meta = shell.store.meta;
      const kind = data.kind || 'house';
      s.phase = 'ended';
      s.ending = kind;
      meta.endings[kind] = (meta.endings[kind] || 0) + 1;
      meta.runs = (meta.runs || 0) + 1;
      shell.store.saveMeta();
      shell.store.discard();

      const E = {
        paid: {
          kicker: 'Ending one of three',
          title: 'Paid Off',
          lede: 'The debt is cleared. The shark counts it twice, shrugs, and tears the page out '
              + 'of the book. Outside it is early and cold and none of you say anything on the way '
              + 'to the car. Mo asks whether you want to go back in with what is left. Nobody answers him.',
        },
        house: {
          kicker: 'Ending two of three',
          title: 'The House',
          lede: 'Three missed quotas. The tower does not throw you out — it finds you a job. '
              + 'There is a name badge with your name already on it, which means somebody printed '
              + 'it days ago. Petra is on the door. She does not look up.',
        },
        runner: {
          kicker: 'Ending three of three',
          title: 'Runner',
          lede: 'You take what is in the account and you go, that night, without telling them. '
              + 'It is enough for a bus and a few months of somewhere else. The debt is still out '
              + 'there and so are your friends, and one of those two will find you first.',
        },
      }[kind];

      const stats = s.stats;
      return {
        sticky: true, title: E.title, width: 'narrow',
        html: '<p class="sheet__kicker">' + E.kicker + '</p>'
          + '<h2 class="sheet__title">' + E.title + '</h2>'
          + '<p class="sheet__lede">' + E.lede + '</p>'
          + '<div class="report">'
          + row('Days survived', String(s.day))
          + row('Hands played', String(stats.hands))
          + row('Total staked', money(stats.wagered))
          + row('Best single win', money(stats.biggestWin), 'good')
          + row('Worst single loss', money(stats.biggestLoss), 'bad')
          + row('Net across the run', (stats.net >= 0 ? '+' : '−') + money(Math.abs(stats.net)),
                stats.net >= 0 ? 'good' : 'bad')
          + row('Tickets in the tin', meta.tickets + '🎟')
          + (s.modded ? row('Modded', 'this run does not count', 'bad') : '')
          + '</div>'
          + '<div class="sheet__actions"><button class="btn btn--primary" data-again>Again</button></div>',
        wire(sheet) {
          sheet.querySelector('[data-again]').addEventListener('click', () => {
            GWState.restart(shell.store);
            shell.unloadGame();
            shell.setMode('idle');
            shell.renderHud();
            shell.renderCrew();
            show('briefing');
          });
        },
      };
    },
  };

  /* --- helpers ------------------------------------------------------------- */

  function payBtn(amount, label) {
    if (amount <= 0) return '';
    return '<button class="chipbtn" data-pay="' + amount + '">'
      + esc(label || money(amount)) + '</button>';
  }

  function payDebt(amount) {
    const s = shell.store.s;
    const paid = Math.max(0, Math.min(amount, s.bank, s.debt));
    if (!paid) { shell.audio.play('deny'); return; }
    s.bank -= paid;
    s.debt -= paid;
    s.settlement.paidOff = (s.settlement.paidOff || 0) + paid;
    shell.audio.play('cash');
    shell.store.say('You hand over ' + money(paid) + '. The shark writes it down.', 'good');
    shell.store.save();
    shell.renderHud();
  }

  function endingNow() {
    const s = shell.store.s;
    if (s.debt <= 0) return 'paid';
    if (s.strikes >= C.MAX_STRIKES) return 'house';
    // Twelve days is the whole arrangement. Reaching the end still owing means
    // the tower keeps you.
    if (s.day >= C.TOTAL_DAYS) return 'house';
    return null;
  }

  /* The challenge on offer today. Drawn from the run's own seed so it is the
     same one every time this day is looked at. */
  function currentChallenge() {
    const s = shell.store.s;
    const index = (s.seed + s.day * 7919) % C.CHALLENGES.length;
    return C.CHALLENGES[index];
  }

  /* Settle the day exactly once.

     This used to run inside the report screen's builder, which meant every
     re-render charged the quota again, added the interest again and took
     another finger. The screen is now a pure render of what this returns. */
  function settle() {
    const s = shell.store.s;
    const meta = shell.store.meta;
    const opening = s.dayOpeningBank === undefined ? s.bank : s.dayOpeningBank;

    let refund = 0;
    if (shell.store.has('insurance') && s.biggestLossToday > 0) {
      refund = Math.round(s.biggestLossToday / 2);
      shell.store.credit(refund, null);
    }
    const closing = s.bank;

    const met = s.bank >= s.quota;
    let ticketsEarned = 0;
    let taken = null;
    if (met) {
      s.bank -= s.quota;
      ticketsEarned = 1 + (s.bank >= s.quota ? 1 : 0);
      meta.tickets += ticketsEarned;
    } else {
      s.strikes++;
      taken = takeSomething();
    }

    // The loan shark pays for his own challenge, and only if it was accepted
    // before the day started and actually done during it.
    let challengeWon = null;
    if (s.challenge && s.challenge.accepted) {
      const def = C.CHALLENGES.find((ch) => ch.id === s.challenge.id);
      const tally = s.challengeState || GWState.newTally();
      if (def && def.check(tally, C.FLOORS[s.floor], met, s)) {
        meta.tickets += def.tickets;
        challengeWon = { text: def.text, tickets: def.tickets };
      }
    }
    s.challenge = null;

    /* What the shark charges tonight. The repellent takes it down, and every
       word you have had with him takes a point off permanently -- both applied
       here, which is the only place interest is worked out. */
    const words = (meta.perks.friendlyshark || 0) * 0.01;
    const rate = Math.max(0.01,
      (shell.store.has('repellent') ? C.INTEREST * 0.6 : C.INTEREST) - words);
    const interest = Math.round(s.debt * rate);
    s.debt += interest;

    meta.best = Math.max(meta.best || 0, s.stats.net);
    shell.store.saveMeta();

    s.settlement = { day: s.day, opening, closing, refund, met, quota: s.quota,
                     ticketsEarned, taken, interest, paidOff: 0, challengeWon };
    shell.store.save();
    return s.settlement;
  }

  function row(label, value, tone) {
    return '<div class="reportrow"><span>' + esc(label) + '</span><span'
      + (tone ? ' class="reportrow__' + tone + '"' : '') + '>' + esc(value) + '</span></div>';
  }
  function rule(label, text) {
    return '<div class="reportrow" style="grid-template-columns:9rem 1fr"><span><b>'
      + esc(label) + '</b></span><span style="text-align:left;color:var(--text-muted)">'
      + esc(text) + '</span></div>';
  }
  function tabBtn(id, active, label) {
    return '<button class="shoptab" role="tab" data-tab="' + id + '" aria-selected="'
      + (id === active) + '">' + esc(label) + '</button>';
  }

  /* Buying puts it on the shop's shelf. Someone still has to pick it up.

     That is the shop's rule in the game this follows, and it is a good one: it
     turns "spend money" into "spend money and then walk over there", which is
     exactly the sort of thing four people in a hurry get wrong. */
  function buyItem(id) {
    const item = C.ITEMS.find((i) => i.id === id);
    const s = shell.store.s;
    if (!s.pendingItems) s.pendingItems = [];
    const owned = shell.store.has(id) || s.pendingItems.indexOf(id) >= 0;
    if (!item || owned || s.bank < item.price) { shell.audio.play('deny'); return; }
    s.bank -= item.price;
    s.pendingItems.push(id);
    shell.audio.play('cash');
    shell.store.say('The ' + item.name + ' goes on the collection shelf. Pick it up '
      + 'before you get in the limo.', 'warn');
    shell.renderHud();
    shell.store.save();
  }

  function buyPerk(id) {
    const perk = C.TICKET_SHOP.find((p) => p.id === id);
    const meta = shell.store.meta;
    const owned = meta.perks[id] || 0;
    if (!perk || meta.tickets < perk.cost) { shell.audio.play('deny'); return; }
    if ((!perk.repeat && owned) || (perk.max && owned >= perk.max)) { shell.audio.play('deny'); return; }
    meta.tickets -= perk.cost;
    meta.perks[id] = owned + 1;
    shell.audio.play('cash');

    // Some perks land on the run in progress rather than the next one.
    const s = shell.store.s;
    if (id === 'forgiveness') s.debt = Math.max(0, s.debt - 2000);
    if (id === 'extrashout') s.shouts++;
    if (id === 'prosthetic') {
      const sold = Object.keys(s.sold);
      if (sold.length) {
        delete s.sold[sold[0]];
        shell.store.say('A prosthetic. It is not the same, but it works.', 'good');
      }
    }
    shell.store.saveMeta();
    shell.store.save();
    shell.renderHud();
  }

  function sellPart(id) {
    const part = C.BODY_PARTS.find((p) => p.id === id);
    const s = shell.store.s;
    if (!part || shell.store.sold(id)) { shell.audio.play('deny'); return; }
    s.sold[id] = true;
    s.bank += part.cash;
    shell.store.meta.tickets += part.tickets;
    if (id === 'kidney') s.timeLeft = Math.max(0, s.timeLeft - 30);
    if (id === 'finger') s.shouts = Math.max(0, s.shouts - 1);
    shell.audio.play('bust');
    shell.store.say('You sell ' + part.name.toLowerCase() + '. ' + part.cost, 'bad');
    shell.store.saveMeta();
    shell.store.save();
    shell.renderHud();
  }

  /* When the quota is missed the shark takes something. Duct tape is the one
     thing that can be handed over instead, which is the entire point of it. */
  function takeSomething() {
    const s = shell.store.s;
    if (shell.store.has('ducttape')) {
      delete s.items.ducttape;
      return 'the duct tape, oddly';
    }
    const items = Object.keys(s.items);
    if (items.length) {
      const id = items[Math.floor(shell.store.rng.next() * items.length)];
      const item = C.ITEMS.find((i) => i.id === id);
      delete s.items[id];
      return 'your ' + (item ? item.name : id);
    }
    const left = C.BODY_PARTS.filter((p) => !shell.store.sold(p.id));
    if (left.length) {
      const part = left[Math.floor(shell.store.rng.next() * left.length)];
      s.sold[part.id] = true;
      if (part.id === 'kidney') s.timeLeft = Math.max(0, s.timeLeft - 30);
      return part.name.toLowerCase();
    }
    const bite = Math.round(s.bank * 0.5);
    s.bank -= bite;
    return 'half of what is left — ' + money(bite);
  }

  function nextDay() {
    const s = shell.store.s;
    s.day++;
    s.quota = C.quotaFor(s.day);
    s.shouts = C.SHOUTS_PER_DAY + (shell.store.meta.perks.extrashout || 0)
      - (shell.store.sold('finger') ? 1 : 0);
    s.dailyUsed = {};
    s.biggestLossToday = 0;
    s.crowbarFloor = -1;
    s.dayOpeningBank = s.bank;
    s.challenge = null;
    s.challengeState = GWState.newTally();
    s.phase = 'lobby';
    for (const mate of s.friends) {
      mate.patience = Math.min(1, mate.patience + 0.45);
      mate.cooldown = 5 + shell.store.rng.next() * 6;
      mate.at = null;
    }
    shell.store.save();
    shell.renderHud();
  }

  global.GWScreens = { init, show, close, refresh, isOpen, settle };
})(window);
