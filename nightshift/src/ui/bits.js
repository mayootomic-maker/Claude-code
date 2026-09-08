/* Shared pieces of interface: an avatar that is the real character drawing,
   a toast, and the confirm used before anything you cannot take back. */

(function (NS) {
  'use strict';

  const U = NS.util;
  const el = U.el;

  /* Portraits are the same canvas drawing as the world, not a second set of
     images -- so a hat you picked in the lobby is the hat on your body when
     somebody finds it. */
  function avatar(colorIdx, hatIdx, size, opts) {
    const o = opts || {};
    const canvas = el('canvas', { class: 'avatar' + (o.class ? ' ' + o.class : '') });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(size / 2, size / 2);
    NS.characters.drawAvatar(ctx, colorIdx, hatIdx, size * 0.94, o);
    return canvas;
  }

  /* Announcements for a screen reader. Toasts are visual and transient; this
     is the same information as text, in order, for somebody who is not looking
     at the station. Deliberately terse -- a live region that narrates every
     footstep is worse than none. */
  let announcer = null;
  function announce(text) {
    if (!announcer) {
      announcer = el('div', {
        class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true',
      });
      document.body.appendChild(announcer);
    }
    /* Same string twice in a row is not re-read by most screen readers, so it
       is cleared first. */
    announcer.textContent = '';
    setTimeout(() => { if (announcer) announcer.textContent = text; }, 60);
  }

  let toastHost = null;
  function toast(text, kind, seconds) {
    if (!toastHost) {
      toastHost = el('div', { class: 'toasts', 'aria-live': 'polite' });
      document.body.appendChild(toastHost);
    }
    const node = el('div', { class: 'toast toast--' + (kind || 'info'), text });
    toastHost.appendChild(node);
    const life = (seconds || 3.4) * 1000;
    setTimeout(() => node.classList.add('is-out'), life - 260);
    setTimeout(() => node.remove(), life);
    return node;
  }

  function confirm(opts) {
    return new Promise((resolve) => {
      const root = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
      const box = el('div', { class: 'sheet-box' }, [
        el('h3', { text: opts.title }),
        opts.body ? el('p', { text: opts.body }) : null,
        el('div', { class: 'sheet-row' }, [
          el('button', {
            class: 'btn btn--ghost', type: 'button', text: opts.cancel || 'Back',
            onclick: () => { root.remove(); resolve(false); },
          }),
          el('button', {
            class: 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'), type: 'button',
            text: opts.confirm || 'Do it',
            onclick: () => { root.remove(); resolve(true); },
          }),
        ]),
      ]);
      root.appendChild(box);
      root.addEventListener('click', (e) => {
        if (e.target === root) { root.remove(); resolve(false); }
      });
      document.body.appendChild(root);
      box.querySelector('.btn--primary, .btn--danger').focus();
    });
  }

  /* An icon set drawn as inline SVG paths. Emoji would have been quicker and
     would look like a different application on every device it ran on. */
  const ICONS = {
    use: 'M7 3h10l1 5-4 3v4l-4 3v-7L6 8z',
    report: 'M4 3h16v13H8l-4 4z M12 6v5 M12 13v1.6',
    kill: 'M6 4l12 16 M18 4L6 20',
    vent: 'M4 6h16v12H4z M7 9h10 M7 12h10 M7 15h10',
    map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14',
    tasks: 'M4 6h16 M4 12h16 M4 18h10',
    gear: 'M4 7h7 M15 7h5 M4 12h11 M19 12h1 M4 17h3 M11 17h9 M13 7v0a2 2 0 104 0 2 2 0 10-4 0z M15 12v0a2 2 0 10-4 0 2 2 0 104 0z M7 17v0a2 2 0 104 0 2 2 0 10-4 0z',
    sabotage: 'M12 2l9 18H3z M12 9v5 M12 17v1.5',
    chat: 'M4 5h16v10H9l-5 4z',
    sound: 'M4 9h4l5-4v14l-5-4H4z M16 9c1.5 1.5 1.5 4.5 0 6',
    mute: 'M4 9h4l5-4v14l-5-4H4z M16 9l6 6 M22 9l-6 6',
    close: 'M6 6l12 12 M18 6L6 18',
    ghost: 'M6 20V10a6 6 0 1112 0v10l-3-2-3 2-3-2z M10 10h.01 M14 10h.01',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
    eye: 'M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z M12 10a2 2 0 100 4 2 2 0 000-4z',
    heart: 'M12 20s-8-5-8-10a4 4 0 018-1 4 4 0 018 1c0 5-8 10-8 10z',
  };

  function icon(name, size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size || 22);
    svg.setAttribute('height', size || 22);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'icon');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name] || ICONS.close);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  NS.bits = { avatar, toast, confirm, icon, announce, ICONS };
})(window.NS);
