/* The screen the game opens on.

   There was not one: the page booted, and the first thing it did was put a
   briefing sheet in your face about a run that had already started. A game
   should tell you what it is and let you decide to begin.

   The room behind it is the real one. The stage keeps rendering while this is
   up, with the camera on a slow arc through the lobby, so the first thing you
   see is the place you are about to walk around rather than a picture of it --
   and by the time you press anything the models, the environment map and the
   first frames are all long since paid for. */

(function (global) {
  'use strict';

  let shell = null;
  let node = null;
  let menu = null;
  let open = false;
  let arc = 0;
  let onTick = null;

  function init(s) {
    shell = s;
    node = shell.el.title;
    menu = shell.el.titleMenu;
  }

  /* A slow orbit around the middle of whatever room is loaded, looking slightly
     down. Deliberately not a fly-through: something that moves steadily and
     predictably behind a menu reads as calm, and a camera with opinions behind
     a menu reads as a cutscene you cannot skip. */
  function drive(dt) {
    if (!open || !shell.level) return;
    arc += dt * 0.055;
    const size = shell.level.size;
    const radius = Math.min(size.w, size.d) * 0.30 + 2.2;
    const cam = shell.stage.camera;
    cam.position.set(Math.sin(arc) * radius, 2.15 + Math.sin(arc * 0.7) * 0.28,
                     Math.cos(arc) * radius);
    cam.lookAt(Math.sin(arc + 2.2) * 1.4, 1.15, Math.cos(arc + 2.2) * 1.4);
  }

  function button(spec) {
    const b = document.createElement('button');
    b.className = 'titlebtn' + (spec.primary ? ' titlebtn--primary' : '');
    b.innerHTML = '<span><span class="titlebtn__label"></span>'
      + '<span class="titlebtn__note"></span></span>'
      + '<span class="titlebtn__key"></span>';
    b.querySelector('.titlebtn__label').textContent = spec.label;
    b.querySelector('.titlebtn__note').textContent = spec.note || '';
    b.querySelector('.titlebtn__key').textContent = spec.key || '';
    b.addEventListener('click', () => { shell.audio.play('click'); spec.go(); });
    menu.appendChild(b);
    return b;
  }

  function render() {
    const store = shell.store;
    const s = store.s;
    menu.innerHTML = '';

    /* A run is worth continuing when it has actually started. Day one, phase
       "briefing", nothing spent -- that is a fresh save, not a run, and
       offering to continue it is offering nothing. */
    const started = s.phase !== 'briefing' && !s.ending;

    if (started) {
      button({
        label: 'Continue', primary: true,
        note: 'Day ' + s.day + ' · ' + money(s.bank) + ' in the account'
          + (s.debt > 0 ? ' · ' + money(s.debt) + ' owed' : ''),
        go: () => { hide(); shell.resume(); },
      });
      button({
        label: 'New run',
        note: 'Starts again from day one. This one is gone.',
        go: () => {
          if (!confirmOnce(this)) return;
          hide();
          shell.newRun();
        },
      });
    } else {
      button({
        label: 'Play', primary: true,
        note: 'Twelve days, one account, and a debt of ' + money(s.debt),
        go: () => { hide(); shell.resume(); },
      });
    }

    button({
      label: 'Play together',
      note: 'Another window, or another computer. One shared account.',
      key: 'M',
      go: () => { hide(); GWScreens.show('table'); },
    });
    button({
      label: 'How this works',
      note: 'The rules, the odds, and what your friends are allowed to do',
      go: () => { hide(); GWScreens.show('rules'); },
    });
    button({
      label: 'Settings',
      note: 'Look sensitivity, camera, sound',
      key: 'F1',
      go: () => { hide(); GWModMenu.toggle('display'); },
    });

    shell.el.titleTickets.textContent = store.meta.tickets === 1
      ? '1 ticket' : store.meta.tickets + ' tickets';
  }

  /* Wiping a run is the one thing here that cannot be undone, so it asks --
     once, in place, rather than in a dialog on top of a menu. */
  function confirmOnce(button_) {
    const b = menu.querySelector('.titlebtn:not(.titlebtn--primary)');
    if (!b || b.dataset.armed) return true;
    b.dataset.armed = '1';
    b.querySelector('.titlebtn__label').textContent = 'Sure?';
    b.querySelector('.titlebtn__note').textContent = 'This deletes the run in progress.';
    setTimeout(() => {
      if (!b.dataset.armed) return;
      delete b.dataset.armed;
      b.querySelector('.titlebtn__label').textContent = 'New run';
      b.querySelector('.titlebtn__note').textContent = 'Starts again from day one. This one is gone.';
    }, 4000);
    return false;
  }

  function show() {
    open = true;
    render();
    node.hidden = false;
    document.documentElement.classList.add('is-title');
    if (!onTick) onTick = shell.stage.onTick(drive);
    shell.stage.setManualCamera(true);
  }

  function hide() {
    open = false;
    node.hidden = true;
    document.documentElement.classList.remove('is-title');
    if (onTick) { onTick(); onTick = null; }
  }

  const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

  global.GWTitle = { init, show, hide, render, get isOpen() { return open; } };
})(window);
