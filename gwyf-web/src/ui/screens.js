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

  /* `sticky` means Escape and a click on the backdrop will not dismiss it --
     the briefing, the nightly report and the endings all demand an answer. It
     does not mean the screen's own buttons cannot close it, which is what the
     first version did, leaving the briefing welded over the whole game. */
  function close(force) {
    if (!current) return false;
    if (current.sticky && !force) return false;
    root.innerHTML = '';
    current = null;
    return true;
  }

  function show(name, data) {
    root.innerHTML = '';
    const builder = SCREENS[name];
    if (!builder) return;
    const spec = builder(data || {});
    current = { name, sticky: !!spec.sticky };

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
      const crew = s.friends.map((f) =>
        '<li class="mate"><span class="mate__dot" style="background:' + f.colour + ';color:' + f.colour + '"></span>'
        + '<span><span class="mate__name">' + esc(f.name) + '</span>'
        + '<span class="mate__where">' + esc(f.blurb) + '</span></span><span></span></li>').join('');

      return {
        sticky: true, title: 'Day ' + s.day,
        html: '<p class="sheet__kicker">' + (first ? 'The arrangement' : 'Day ' + s.day) + '</p>'
          + '<h2 class="sheet__title">' + (first ? 'Gamble With Your Friends' : 'Five more minutes') + '</h2>'
          + (first
            ? '<p class="sheet__lede">One bank account between the four of you and a debt with '
              + 'someone who does not do paperwork. Five minutes inside the tower each day, and a '
              + 'quota to hit before the doors close.</p>'
              + '<p class="sheet__lede">Your friends can spend the account too. That is not a bug.</p>'
            : '<p class="sheet__lede">The doors open for five minutes. Everything in the account is '
              + 'everybody’s, including theirs.</p>')
          + '<div class="report">'
          + row('In the account', money(s.bank))
          + row('Tonight’s quota', money(s.quota), s.bank >= s.quota ? 'good' : 'bad')
          + row('Owed to the shark', money(s.debt), 'bad')
          + (s.strikes ? row('Missed quotas', s.strikes + ' of ' + C.MAX_STRIKES, 'bad') : '')
          + '</div>'
          + '<h3 class="rail__label" style="margin-top:1rem">Who is coming in with you</h3>'
          + '<ul class="crew">' + crew + '</ul>'
          + '<div class="sheet__actions">'
          + '<button class="btn btn--primary" data-go>Open the doors</button>'
          + (first ? '<button class="btn btn--ghost" data-how>How this works</button>' : '')
          + '</div>',
        wire(sheet) {
          sheet.querySelector('[data-go]').addEventListener('click', () => {
            shell.store.meta.seenIntro = true;
            shell.store.saveMeta();
            shell.store.s.phase = 'floor';
            close(true);
            shell.enterFloor(shell.store.s.floor, shell.store.s.game);
            shell.store.say('Day ' + shell.store.s.day + '. Quota is ' + money(shell.store.s.quota) + '.', 'house');
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

    tower() {
      const s = shell.store.s;
      const floors = shell.store.unlockedFloors().map((entry, i) => {
        const f = entry.floor;
        const games = f.games.map((id) => GWGames.get(id)).filter(Boolean);
        return '<button class="floorcard" style="--floor-accent:' + f.accent + '"'
          + (entry.open ? '' : ' disabled') + ' data-floor="' + i + '">'
          + '<span class="floorcard__no">' + i + '</span>'
          + '<span><span class="floorcard__name">' + esc(f.name) + '</span>'
          + '<p class="floorcard__blurb">' + esc(f.blurb) + '</p>'
          + '<p class="floorcard__games">' + games.map((g) => g.icon + ' ' + esc(g.name)).join(' · ')
          + ' — bets ' + money(f.minBet) + ' to ' + money(f.maxBet) + '</p></span>'
          + '<span class="floorcard__lock">' + (entry.open ? (i === s.floor ? 'You are here' : 'Open')
            : 'Opens at ' + money(f.unlockBank)) + '</span></button>';
      }).join('');

      const here = C.FLOORS[s.floor];
      const tables = here.games.map((id) => {
        const g = GWGames.get(id);
        if (!g) return '';
        const edge = g.paysAsRtp
          ? (100 - g.bets[0].pays * 100).toFixed(1)
          : (Math.min.apply(null, g.bets.map((b) => GWGames.edge(b))) * 100).toFixed(1);
        return '<button class="gamecard" data-game="' + id + '">'
          + '<span class="gamecard__icon">' + g.icon + '</span>'
          + '<span class="gamecard__name">' + esc(g.name) + '</span>'
          + '<span class="gamecard__edge">house takes ' + edge + '%</span></button>';
      }).join('');

      return {
        title: 'The lift', width: 'wide',
        html: '<p class="sheet__kicker">The lift</p><h2 class="sheet__title">Which floor</h2>'
          + '<div class="floors">' + floors + '</div>'
          + '<h3 class="rail__label" style="margin:1.4rem 0 0.5rem">Tables on ' + esc(here.name) + '</h3>'
          + '<div class="gamegrid">' + tables + '</div>'
          + '<div class="sheet__actions"><button class="btn" data-close>Back to the table</button></div>',
        wire(sheet) {
          for (const b of sheet.querySelectorAll('[data-floor]')) {
            b.addEventListener('click', () => {
              shell.enterFloor(Number(b.dataset.floor));
              show('tower');
            });
          }
          for (const b of sheet.querySelectorAll('[data-game]')) {
            b.addEventListener('click', () => { shell.loadGame(b.dataset.game); close(); });
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
        body = '<div class="wares">' + C.ITEMS.map((item) => {
          const owned = shell.store.has(item.id);
          const can = !owned && s.bank >= item.price;
          return '<button class="ware' + (owned ? ' is-owned' : '') + '"'
            + (can ? '' : ' disabled') + ' data-item="' + item.id + '">'
            + '<span class="ware__icon">' + item.icon + '</span>'
            + '<span><span class="ware__name">' + esc(item.name)
            + '<span class="ware__price">' + (owned ? 'owned' : money(item.price)) + '</span></span>'
            + '<span class="ware__desc">' + esc(item.desc) + '</span></span></button>';
        }).join('') + '</div>';
      } else if (tab === 'tickets') {
        body = '<div class="wares">' + C.TICKET_SHOP.map((perk) => {
          const owned = meta.perks[perk.id] || 0;
          const maxed = (!perk.repeat && owned) || (perk.max && owned >= perk.max);
          const can = !maxed && meta.tickets >= perk.cost;
          return '<button class="ware' + (owned ? ' is-owned' : '') + '"'
            + (can ? '' : ' disabled') + ' data-perk="' + perk.id + '">'
            + '<span class="ware__icon">🎟️</span>'
            + '<span><span class="ware__name">' + esc(perk.name)
            + '<span class="ware__price">' + (maxed ? 'maxed' : perk.cost + ' tickets') + '</span></span>'
            + '<span class="ware__desc">' + esc(perk.desc)
            + (owned ? ' <b>(owned ×' + owned + ')</b>' : '') + '</span></span></button>';
        }).join('') + '</div>'
        + '<p class="odds__foot" style="margin-top:0.8rem">Tickets survive a wipe. They are the only '
        + 'thing here that does.</p>';
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
          if (next) next.addEventListener('click', () => { nextDay(); show('briefing'); });
          const shopBtn = sheet.querySelector('[data-shop]');
          if (shopBtn) shopBtn.addEventListener('click', () => show('shop', { from: 'report' }));
          const end = sheet.querySelector('[data-end]');
          if (end) end.addEventListener('click', () => show('ending', { kind: end.dataset.end }));
          const run = sheet.querySelector('[data-run]');
          if (run) run.addEventListener('click', () => show('ending', { kind: 'runner' }));
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
    return null;
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

    const rate = shell.store.has('repellent') ? 0.05 : C.INTEREST;
    const interest = Math.round(s.debt * rate);
    s.debt += interest;

    meta.best = Math.max(meta.best || 0, s.stats.net);
    shell.store.saveMeta();

    s.settlement = { day: s.day, opening, closing, refund, met, quota: s.quota,
                     ticketsEarned, taken, interest, paidOff: 0 };
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

  function buyItem(id) {
    const item = C.ITEMS.find((i) => i.id === id);
    const s = shell.store.s;
    if (!item || shell.store.has(id) || s.bank < item.price) { shell.audio.play('deny'); return; }
    s.bank -= item.price;
    s.items[id] = 1;
    shell.audio.play('cash');
    shell.store.say('You buy the ' + item.name + '. ' + item.desc, 'good');
    if (id === 'stopwatch') { s.timeLeft += 45; }
    if (id === 'crowbar') { s.crowbarFloor = Math.min(C.FLOORS.length - 1, s.floor + 1); }
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
    s.timeLeft = C.DAY_SECONDS
      + (shell.store.has('stopwatch') ? 45 : 0)
      - (shell.store.sold('kidney') ? 30 : 0);
    s.shouts = C.SHOUTS_PER_DAY + (shell.store.meta.perks.extrashout || 0)
      - (shell.store.sold('finger') ? 1 : 0);
    s.dailyUsed = {};
    s.biggestLossToday = 0;
    s.crowbarFloor = -1;
    s.dayOpeningBank = s.bank;
    s.phase = 'briefing';
    for (const mate of s.friends) {
      mate.patience = Math.min(1, mate.patience + 0.45);
      mate.cooldown = 5 + shell.store.rng.next() * 6;
      mate.at = null;
    }
    shell.store.save();
    shell.renderHud();
  }

  global.GWScreens = { init, show, close, isOpen, settle };
})(window);
