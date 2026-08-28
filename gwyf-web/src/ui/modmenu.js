/* The mod menu.

   This exists because the repository it lives in already contains a mod menu
   for the real game, and a browser port with no way in would be a strange thing
   to ship next to it. It is deliberately not hidden: it is on F1, it says what
   every switch does, and switching any of them on marks the run so the endings
   know they were not earned.

   Layout, categories and switch styling follow the GambleMenu Velvet theme, so
   the two look like the same tool. */

(function (global) {
  'use strict';

  const C = GWConfig;
  let shell = null, node = null, page = 'economy';

  const PAGES = [
    { id: 'economy', name: 'Economy' },
    { id: 'odds', name: 'Odds' },
    { id: 'time', name: 'Time' },
    { id: 'progress', name: 'Progression' },
    { id: 'crew', name: 'The crew' },
    { id: 'display', name: 'Display' },
    { id: 'save', name: 'Save data' },
  ];

  /* Every switch. `mod` toggles a flag the games read; `act` does something once. */
  const MODS = {
    economy: [
      { id: 'infiniteMoney', name: 'Bottomless account', desc: 'Bets cost nothing and wins pay anyway.' },
      { act: 'give10k', name: 'Add $10,000', desc: 'Straight into the shared account.' },
      { act: 'clearDebt', name: 'Clear the debt', desc: 'The shark loses the page.' },
      { act: 'tickets', name: 'Add 5 tickets', desc: 'Spendable in the back office.' },
    ],
    odds: [
      { id: 'alwaysWin', name: 'Never lose', desc: 'Every table finds a way for you to win.' },
      { id: 'alwaysLose', name: 'Never win', desc: 'The other one. Somebody always asks.' },
      { id: 'xray', name: 'X-ray', desc: 'Mines announces itself before you dig.' },
    ],
    time: [
      { id: 'freezeClock', name: 'Freeze the clock', desc: 'The day stops running down.' },
      { act: 'addTime', name: 'Add two minutes', desc: 'To the day in progress.' },
    ],
    progress: [
      { id: 'allFloors', name: 'Open every floor', desc: 'The lift stops ignoring you.' },
      { act: 'allItems', name: 'Grant every item', desc: 'All sixteen, free.' },
      { act: 'nextDay', name: 'End the day now', desc: 'Skip straight to the reckoning.' },
    ],
    crew: [
      { id: 'calmFriends', name: 'Nobody tilts', desc: 'Your friends never go all in.' },
      { id: 'quietFriends', name: 'Nobody plays', desc: 'They stop touching the account entirely.' },
    ],
    display: [
      { id: 'reducedMotion', name: 'Reduce motion', desc: 'Shorter animations everywhere.' },
      { act: 'quality', name: 'Halve the resolution', desc: 'For a machine that is struggling.' },
      { act: 'fullQuality', name: 'Full resolution', desc: 'Put it back.' },
    ],
    save: [
      { act: 'export', name: 'Export the run', desc: 'Downloads a JSON file of everything.' },
      { act: 'import', name: 'Import a run', desc: 'Reads one back in.' },
      { act: 'wipe', name: 'Wipe everything', desc: 'Run, tickets, perks. No confirmation twice.' },
    ],
  };

  function init(s) { shell = s; }

  function toggle() { if (node) closeMenu(); else open(); }

  function open() {
    node = document.createElement('div');
    node.className = 'modmenu';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-label', 'Mod menu');
    document.body.appendChild(node);
    render();
    shell.audio.play('door');
  }

  function closeMenu() {
    if (node) node.remove();
    node = null;
  }

  function render() {
    if (!node) return;
    const s = shell.store.s;
    const rows = (MODS[page] || []).map((mod) => {
      const on = mod.id ? !!s.mods[mod.id] : false;
      return '<div class="modrow"><span><span class="modrow__name">' + esc(mod.name)
        + '</span><br><span class="modrow__desc">' + esc(mod.desc) + '</span></span>'
        + (mod.id
          ? '<button class="switch" role="switch" aria-checked="' + on + '" data-mod="' + mod.id
            + '" aria-label="' + esc(mod.name) + '"><i></i></button>'
          : '<button class="btn" data-act="' + mod.act + '">Do it</button>')
        + '</div>';
    }).join('');

    node.innerHTML = '<div class="modmenu__head">'
      + '<span class="modmenu__title">GambleMenu</span>'
      + '<span class="modrow__desc">web build · F1</span>'
      + '<span class="modmenu__warn">' + (s.modded ? 'this run is marked modded' : 'nothing switched on yet')
      + '</span>'
      + '<button class="icobtn" data-close aria-label="Close the mod menu">✕</button></div>'
      + '<nav class="modmenu__side" role="tablist">'
      + PAGES.map((p) => '<button class="modtab" role="tab" data-page="' + p.id + '" aria-selected="'
          + (p.id === page) + '">' + esc(p.name) + '</button>').join('')
      + '</nav><div class="modmenu__body">' + rows + '</div>';

    node.querySelector('[data-close]').addEventListener('click', closeMenu);
    for (const b of node.querySelectorAll('[data-page]')) {
      b.addEventListener('click', () => { page = b.dataset.page; render(); });
    }
    for (const b of node.querySelectorAll('[data-mod]')) {
      b.addEventListener('click', () => { flip(b.dataset.mod); render(); });
    }
    for (const b of node.querySelectorAll('[data-act]')) {
      b.addEventListener('click', () => { act(b.dataset.act); render(); });
    }
  }

  function flip(id) {
    const s = shell.store.s;
    s.mods[id] = !s.mods[id];
    // Never-win and never-lose cancel each other; holding both would leave the
    // rejection loops in the games searching for an outcome that cannot exist.
    if (id === 'alwaysWin' && s.mods.alwaysWin) s.mods.alwaysLose = false;
    if (id === 'alwaysLose' && s.mods.alwaysLose) s.mods.alwaysWin = false;
    if (s.mods[id]) mark();
    if (id === 'reducedMotion' && shell.applyMotion) shell.applyMotion();
    if (id === 'quietFriends' || id === 'calmFriends') shell.renderCrew();
    shell.audio.play('click');
    shell.renderHud();
    shell.store.save();
  }

  function mark() {
    const s = shell.store.s;
    if (s.modded) return;
    s.modded = true;
    shell.store.say('Mod menu used. This run still finishes — it just does not count.', 'warn');
  }

  function act(what) {
    const s = shell.store.s;
    const store = shell.store;
    switch (what) {
      case 'give10k': s.bank += 10000; mark(); break;
      case 'clearDebt': s.debt = 0; mark(); break;
      case 'tickets': store.meta.tickets += 5; store.saveMeta(); mark(); break;
      case 'addTime': s.timeLeft += 120; mark(); break;
      case 'allItems': for (const i of C.ITEMS) s.items[i.id] = 1; mark(); break;
      case 'nextDay': closeMenu(); shell.endDay(); return;
      case 'quality': shell.stage.setQuality(0.5); break;
      case 'fullQuality': shell.stage.setQuality(1); break;
      case 'export': exportSave(); break;
      case 'import': importSave(); break;
      case 'wipe': wipe(); return;
      default: break;
    }
    shell.audio.play('cash');
    shell.renderHud();
    shell.renderBets();
    store.save();
  }

  function exportSave() {
    const json = JSON.stringify({
      run: shell.store.s, meta: shell.store.meta, exported: new Date().toISOString(),
    }, null, 2);

    /* Two routes out, because one of them does not always work.

       A page-initiated download -- an <a download> with a blob URL -- is inert
       inside a sandboxed embed, and it fails silently: no error, no file, no
       clue. So the clipboard is tried first and the download is offered as
       well, and whichever succeeded is what the ticker says. Never claim a file
       was saved without knowing that it was. */
    const offerDownload = () => {
      try {
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gamble-with-your-friends-day' + shell.store.s.day + '.json';
        a.rel = 'noopener';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 8000);
        return true;
      } catch (err) {
        return false;
      }
    };

    const showText = () => {
      // Last resort: put it on screen so it can be selected and copied by hand.
      const box = document.createElement('textarea');
      box.className = 'exportbox';
      box.readOnly = true;
      box.value = json;
      box.setAttribute('aria-label', 'Your run, as JSON. Select all and copy.');
      const wrap = document.createElement('div');
      wrap.className = 'screen';
      const sheet = document.createElement('div');
      sheet.className = 'sheet sheet--narrow';
      sheet.innerHTML = '<p class="sheet__kicker">Save data</p>'
        + '<h2 class="sheet__title">Copy this somewhere</h2>'
        + '<p class="sheet__lede">This browser would not let the page hand you a '
        + 'file or reach the clipboard. Select it all and copy it by hand.</p>';
      sheet.appendChild(box);
      const done = document.createElement('div');
      done.className = 'sheet__actions';
      done.innerHTML = '<button class="btn btn--primary">Done</button>';
      done.querySelector('button').addEventListener('click', () => wrap.remove());
      sheet.appendChild(done);
      wrap.appendChild(sheet);
      document.body.appendChild(wrap);
      box.focus();
      box.select();
    };

    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(json).then(() => {
        const downloaded = offerDownload();
        shell.store.say('Run copied to the clipboard'
          + (downloaded ? ', and offered as a file.' : '. Paste it somewhere safe.'), 'good');
      }, () => {
        if (!offerDownload()) showText();
        else shell.store.say('Run exported as a file.', 'good');
      });
      return;
    }
    if (offerDownload()) shell.store.say('Run exported as a file.', 'good');
    else showText();
  }

  function importSave() {
    // A file picker can be blocked in an embed exactly as a download can, so a
    // paste box is offered alongside it rather than instead of an error.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          adopt(JSON.parse(String(reader.result)));
        } catch (err) {
          shell.store.say('That file would not load: ' + err.message, 'bad');
          shell.audio.play('deny');
        }
      };
      reader.readAsText(file);
    });
    input.click();
    // If the picker never opens, the mod menu's paste route is the way in.
    setTimeout(() => {
      if (!input.files || !input.files.length) {
        shell.store.say('If no file picker opened, this browser is blocking it. '
          + 'Paste a saved run into the box instead.', 'warn');
        pasteImport();
      }
    }, 1200);
  }

  /* Paste a run back in. Works where a file picker does not. */
  function pasteImport() {
    if (document.querySelector('.importbox')) return;
    const wrap = document.createElement('div');
    wrap.className = 'screen importbox';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet--narrow';
    sheet.innerHTML = '<p class="sheet__kicker">Save data</p>'
      + '<h2 class="sheet__title">Paste a run</h2>'
      + '<p class="sheet__lede">Paste the JSON you exported earlier.</p>'
      + '<textarea class="exportbox" aria-label="Paste your saved run here"></textarea>'
      + '<div class="sheet__actions"><button class="btn btn--primary" data-load>Load it</button>'
      + '<button class="btn" data-cancel>Cancel</button></div>';
    wrap.appendChild(sheet);
    document.body.appendChild(wrap);
    sheet.querySelector('[data-cancel]').addEventListener('click', () => wrap.remove());
    sheet.querySelector('[data-load]').addEventListener('click', () => {
      try {
        adopt(JSON.parse(sheet.querySelector('textarea').value));
        wrap.remove();
      } catch (err) {
        shell.store.say('That would not load: ' + err.message, 'bad');
        shell.audio.play('deny');
      }
    });
    sheet.querySelector('textarea').focus();
  }

  function adopt(doc) {
    if (!doc.run || doc.run.version !== 2) throw new Error('not a save from this version');
    shell.store.s = doc.run;
    shell.store.meta = Object.assign(shell.store.meta, doc.meta || {});
    shell.store.rng = new GWRng.Rng(doc.run.seed, doc.run.rngCalls || 0);
    shell.store.save();
    closeMenu();
    shell.unloadGame();
    shell.renderHud();
    shell.renderCrew();
    GWScreens.show('briefing');
    shell.store.say('Run imported. Day ' + doc.run.day + '.', 'good');
  }

  function wipe() {
    if (!global.confirm('Wipe the run, the tickets and every perk? This cannot be undone.')) return;
    try {
      global.localStorage.removeItem(GWState.RUN_KEY);
      global.localStorage.removeItem(GWState.META_KEY);
    } catch (e) { /* private mode */ }
    global.location.reload();
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  global.GWModMenu = { init, toggle, close: closeMenu };
})(window);
