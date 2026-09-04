/* The emote wheel.

   Eight things you can do on purpose. The wheel is not how you use them -- the
   number row is, and that is what anybody who plays for ten minutes will use --
   the wheel is how you find out that Dance is on 6. So it opens on G, closes on
   anything, and never blocks the game underneath: you can walk while it is up,
   and pressing the number is the same press whether it is showing or not.

   Every wedge comes out of `GWCrew.EMOTES`, which is the same table the keys and
   the animation read. A wheel with its own hard-coded list is a wheel that says
   Dance is on 6 after somebody moves Dance to 7. */

(function (global) {
  'use strict';

  let root = null, open = false, shell = null;

  function build() {
    if (root) return root;
    root = global.document.createElement('div');
    root.className = 'emotes';
    root.id = 'emoteWheel';
    root.hidden = true;
    /* Not a dialog and not focus-trapping. The whole point is that the game
       carries on underneath -- you emote at somebody who is walking away --
       so it announces itself and gets out of the way. */
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Emotes');

    const ring = global.document.createElement('div');
    ring.className = 'emotes__ring';
    const list = GWCrew.EMOTES;
    list.forEach((m, i) => {
      const a = (i / list.length) * Math.PI * 2 - Math.PI / 2;
      const b = global.document.createElement('button');
      b.type = 'button';
      b.className = 'emotes__pick';
      b.dataset.emote = m.id;
      // Placed round the ring in CSS custom properties rather than in a style
      // string, so the stylesheet owns how far out they sit.
      b.style.setProperty('--x', (Math.cos(a) * 50).toFixed(2) + '%');
      b.style.setProperty('--y', (Math.sin(a) * 50).toFixed(2) + '%');
      b.innerHTML = '<span class="emotes__key">' + m.key + '</span>'
                  + '<span class="emotes__label">' + m.label + '</span>';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        if (shell && shell.emote) shell.emote(m.id);
        close();
      });
      ring.appendChild(b);
    });
    root.appendChild(ring);

    const hint = global.document.createElement('p');
    hint.className = 'emotes__hint';
    hint.textContent = 'Press a number, or G to close';
    root.appendChild(hint);

    global.document.body.appendChild(root);
    return root;
  }

  function show() {
    if (!shell || shell.mode !== 'world') return false;
    build();
    root.hidden = false;
    open = true;
    return true;
  }

  function close() {
    if (!open) return false;
    root.hidden = true;
    open = false;
    return true;
  }

  global.GWEmotes = {
    attach(s) { shell = s; },
    toggle() { return open ? close() : show(); },
    show, close,
    isOpen() { return open; },
  };
})(window);
