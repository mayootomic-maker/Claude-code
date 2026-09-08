/* Walking, from a keyboard or a thumb.

   The stick is not drawn in a fixed corner waiting to be found. It appears
   under the thumb wherever the thumb lands in the left half of the screen and
   follows it from there, which is the difference between a control you have
   to look at and one you can use while watching the game. The right half is
   left alone for the action buttons, and a touch that starts on a button is
   never a stick.

   Keys are WASD or the arrows, with the same actions on the keyboard as on
   the buttons so a laptop is not a second-class way to play. */

(function (NS) {
  'use strict';

  const U = NS.util;

  const keys = Object.create(null);
  const vector = { x: 0, y: 0 };
  const stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
  const MAX = 54;

  let node = null;
  let onAction = function () {};
  let enabled = true;

  const KEY_MOVE = {
    KeyW: [0, -1], ArrowUp: [0, -1],
    KeyS: [0, 1], ArrowDown: [0, 1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0],
    KeyD: [1, 0], ArrowRight: [1, 0],
  };
  const KEY_ACTION = {
    KeyE: 'use', Space: 'use', Enter: 'use',
    KeyR: 'report', KeyQ: 'kill', KeyV: 'vent',
    KeyF: 'ability', KeyZ: 'sabotage', KeyM: 'map', KeyT: 'tasks',
  };

  function init(opts) {
    node = opts.stick;
    onAction = opts.onAction || function () {};

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const target = e.target;
      /* Never eat a key somebody is typing into the chat box. */
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (KEY_MOVE[e.code]) { keys[e.code] = true; e.preventDefault(); return; }
      const action = KEY_ACTION[e.code];
      if (action) {
        e.preventDefault();
        if (enabled) onAction(action);
      }
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });
    window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

    const surface = opts.surface || document.body;
    surface.addEventListener('pointerdown', (e) => {
      if (!enabled || stick.active) return;
      if (e.pointerType === 'mouse') return;
      /* Anything with its own job -- a button, the HUD, an open panel --
         handles its own touches. */
      if (e.target.closest('button, .sheet, .mg, .meeting, .screen, input, a')) return;
      if (e.clientX > window.innerWidth * 0.58) return;
      stick.active = true;
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      stick.x = 0; stick.y = 0;
      place();
      node.hidden = false;
      surface.setPointerCapture(e.pointerId);
    });
    surface.addEventListener('pointermove', (e) => {
      if (!stick.active || e.pointerId !== stick.id) return;
      const dx = e.clientX - stick.ox;
      const dy = e.clientY - stick.oy;
      const len = Math.hypot(dx, dy);
      const clamped = Math.min(len, MAX);
      const a = Math.atan2(dy, dx);
      stick.x = len < 1 ? 0 : Math.cos(a) * clamped;
      stick.y = len < 1 ? 0 : Math.sin(a) * clamped;
      place();
    });
    const drop = (e) => {
      if (!stick.active || (e.pointerId != null && e.pointerId !== stick.id)) return;
      stick.active = false;
      stick.id = null;
      stick.x = 0; stick.y = 0;
      node.hidden = true;
    };
    surface.addEventListener('pointerup', drop);
    surface.addEventListener('pointercancel', drop);
  }

  function place() {
    if (!node) return;
    node.style.left = stick.ox + 'px';
    node.style.top = stick.oy + 'px';
    node.querySelector('.stick-knob').style.transform =
      'translate(' + (stick.x - 50) + '%, ' + (stick.y - 50) + '%)';
  }

  /* One vector, whichever way it was asked for. Keyboard input is normalised
     the same way the stick is, so diagonals are not faster. */
  function read() {
    let x = 0, y = 0;
    for (const code in KEY_MOVE) {
      if (!keys[code]) continue;
      x += KEY_MOVE[code][0];
      y += KEY_MOVE[code][1];
    }
    if (stick.active && (stick.x || stick.y)) {
      const len = Math.hypot(stick.x, stick.y);
      const dead = 9;
      if (len > dead) {
        const power = Math.min(1, (len - dead) / (MAX - dead));
        x = (stick.x / len) * power;
        y = (stick.y / len) * power;
      } else { x = 0; y = 0; }
    }
    vector.x = U.clamp(x, -1, 1);
    vector.y = U.clamp(y, -1, 1);
    return vector;
  }

  function setEnabled(v) {
    enabled = !!v;
    if (!enabled) {
      stick.active = false;
      stick.x = stick.y = 0;
      for (const k in keys) keys[k] = false;
      if (node) node.hidden = true;
    }
  }

  NS.input = { init, read, setEnabled, get vector() { return vector; } };
})(window.NS);
