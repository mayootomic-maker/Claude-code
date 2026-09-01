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
      { pref: 'look', name: 'Look sensitivity', desc: 'How far the view turns for the same hand movement.',
        min: 0.25, max: 3, step: 0.05 },
      { pref: 'invertY', name: 'Invert look', desc: 'Push the mouse forward to look down.' },
      { pref: 'smoothing', name: 'Camera smoothing', desc: 'How much the view lags the mouse. Zero, the default, is exact.',
        min: 0, max: 1, step: 0.05 },
      { pref: 'headBob', name: 'Head bob', desc: 'The walk in the camera. Off holds it steady.' },
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

  /* `toggle('display')` opens straight onto a page, which is how the title
     screen's Settings gets you to the controls rather than to whichever tab was
     last looked at. */
  function toggle(startPage) {
    if (node) { closeMenu(); return; }
    if (startPage && MODS[startPage]) page = startPage;
    open();
  }

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
        + control(mod, s, on)
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
    for (const b of node.querySelectorAll('[data-pref]')) {
      if (b.tagName === 'INPUT') {
        // Live, not on release: a sensitivity you cannot feel while dragging is
        // one you have to set by guessing.
        b.addEventListener('input', () => {
          setPref(b.dataset.pref, Number(b.value));
          const out = b.parentElement.querySelector('output');
          if (out) out.textContent = Number(b.value).toFixed(2) + '\u00d7';
        });
      } else {
        b.addEventListener('click', () => {
          setPref(b.dataset.pref, !shell.store.meta[b.dataset.pref]);
          shell.audio.play('click');
          render();
        });
      }
    }
  }

  /* Three kinds of row. `mod` flips a flag the games read and marks the run,
     `act` does something once, and `pref` is a control setting -- it belongs to
     the person, not the run, so it saves to meta and never marks anything. */
  function control(mod, s, on) {
    if (mod.id) {
      return '<button class="switch" role="switch" aria-checked="' + on + '" data-mod="' + mod.id
        + '" aria-label="' + esc(mod.name) + '"><i></i></button>';
    }
    if (mod.act) return '<button class="btn" data-act="' + mod.act + '">Do it</button>';
    const value = shell.store.meta[mod.pref];
    if (mod.min === undefined) {
      return '<button class="switch" role="switch" aria-checked="' + !!value + '" data-pref="' + mod.pref
        + '" aria-label="' + esc(mod.name) + '"><i></i></button>';
    }
    return '<span class="modrow__slider"><input type="range" data-pref="' + mod.pref
      + '" min="' + mod.min + '" max="' + mod.max + '" step="' + mod.step
      + '" value="' + value + '" aria-label="' + esc(mod.name) + '">'
      + '<output>' + (+value).toFixed(2) + '×</output></span>';
  }

  function setPref(name, value) {
    shell.store.meta[name] = value;
    shell.store.saveMeta();
    if (shell.applyLook) shell.applyLook();
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

  /* Hand the run to the player.

     Three routes, because which one exists depends on where the page is open:

       - Inside the claude.ai artifact viewer, a page cannot download anything
         by itself. It asks the host, through the `downloads` capability, and
         the viewer confirms or declines.
       - Opened from disk or served normally, a blob download is the real thing
         and works.
       - Where neither is available, the JSON goes on screen to be copied.

     What matters is that nothing here claims a file was saved unless one was.
     An <a download> inside a sandboxed frame does nothing at all, silently --
     no error, no file, no clue -- and reporting success off the back of it is
     how a player loses a run they think they saved. */
  async function exportSave() {
    const json = JSON.stringify({
      run: shell.store.s, meta: shell.store.meta, exported: new Date().toISOString(),
    }, null, 2);
    const filename = 'gamble-with-your-friends-day' + shell.store.s.day + '.json';

    const host = global.claude && typeof global.claude.use === 'function' ? global.claude : null;
    if (host) {
      let downloads = null;
      try { downloads = await host.use('downloads'); } catch (err) { downloads = null; }
      if (downloads) {
        try {
          await downloads.save({ filename, data: json });
          shell.store.say('Run saved as ' + filename + '.', 'good');
        } catch (err) {
          const code = err && err.code;
          if (code === 'declined') shell.store.say('Save cancelled. Nothing was written.', 'flat');
          else if (code === 'rate_limited') shell.store.say('Too many save prompts at once. Try again in a moment.', 'warn');
          else showText(json);
        }
        return;
      }
      // The viewer is here but will not save files: do not pretend otherwise.
      showText(json);
      return;
    }

    try {
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.rel = 'noopener';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 8000);
      shell.store.say('Run exported as ' + filename + '.', 'good');
    } catch (err) {
      showText(json);
    }
  }

  /* Last resort: put it on screen so it can be selected and copied by hand.
     Offered with the clipboard where the browser allows it. */
  function showText(json) {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    const sheet = document.createElement('div');
    sheet.className = 'sheet sheet--narrow';
    sheet.innerHTML = '<p class="sheet__kicker">Save data</p>'
      + '<h2 class="sheet__title">Copy this somewhere</h2>'
      + '<p class="sheet__lede">This is your whole run. Keep it and the mod menu '
      + 'can paste it back in later.</p>'
      + '<textarea class="exportbox" readonly aria-label="Your run, as JSON"></textarea>'
      + '<div class="sheet__actions"><button class="btn btn--primary" data-copy>Copy it</button>'
      + '<button class="btn" data-done>Done</button></div>';
    const box = sheet.querySelector('textarea');
    box.value = json;
    wrap.appendChild(sheet);
    document.body.appendChild(wrap);
    sheet.querySelector('[data-done]').addEventListener('click', () => wrap.remove());
    sheet.querySelector('[data-copy]').addEventListener('click', (e) => {
      const say = (text) => { e.target.textContent = text; };
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        global.navigator.clipboard.writeText(json).then(() => say('Copied'), () => say('Select it and copy'));
      } else {
        box.focus(); box.select(); say('Select it and copy');
      }
    });
    box.focus();
    box.select();
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
