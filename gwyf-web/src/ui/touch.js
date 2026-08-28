/* Playing this on a phone.

   There is no pointer lock on iOS and none worth having on Android, so the
   first-person controls need a second set of inputs rather than a smaller
   version of the first: a thumbstick for walking, a drag anywhere else for
   looking, and a button for the thing the keyboard spends E on.

   The controller in world/player.js was written with `stick` and `lookDelta`
   fields for exactly this, so nothing here reaches into the movement code --
   it writes the same two values the keyboard and mouse write and lets the
   solver do the rest.

   It only appears on a device that has a touchscreen and no mouse. A laptop
   with a touchscreen keeps the keyboard controls, because a thumbstick pinned
   over the bottom corner of a desktop window is a bug. */

(function (global) {
  'use strict';

  const RADIUS = 58;          // px of travel before the stick is at full tilt
  const LOOK = 1.0;           // multiplier on the raw drag; player.js scales it again

  function coarse() {
    const mm = global.matchMedia;
    const noHover = mm && mm('(hover: none)').matches;
    const coarsePointer = mm && mm('(pointer: coarse)').matches;
    return !!(global.navigator.maxTouchPoints > 0 && (noHover || coarsePointer));
  }

  function init(opts) {
    const { player, canvas, onInteract, el } = opts;
    if (!coarse()) return null;

    const layer = el.touchLayer;
    const pad = el.touchStick;
    const knob = el.touchKnob;
    layer.hidden = false;
    global.document.documentElement.classList.add('is-touch');

    let stickId = null;
    let stickOrigin = { x: 0, y: 0 };
    let lookId = null;
    let lookLast = { x: 0, y: 0 };

    /* The stick recentres where the thumb lands rather than where it is drawn.
       A fixed pad demands you look at your own thumb before you can walk. */
    function stickDown(e) {
      if (stickId !== null) return;
      stickId = e.pointerId;
      stickOrigin = { x: e.clientX, y: e.clientY };
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('is-held');
      e.preventDefault();
    }

    function stickMove(e) {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - stickOrigin.x;
      let dy = e.clientY - stickOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) { dx = dx / len * RADIUS; dy = dy / len * RADIUS; }
      knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      player.state.stick.x = dx / RADIUS;
      // Screen down is +y and walking forward is -y, so this is not a typo.
      player.state.stick.y = -dy / RADIUS;
      // Push past the ring and you run. Measured before the clamp, and well
      // outside it: at full tilt alone every ordinary walk would be a sprint,
      // and a sprint you cannot avoid is just a faster walk with no walk.
      player.state.sprinting = len > RADIUS * 1.6;
      e.preventDefault();
    }

    function stickUp(e) {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      pad.classList.remove('is-held');
      player.state.stick.x = 0;
      player.state.stick.y = 0;
      player.state.sprinting = false;
    }

    function lookDown(e) {
      if (lookId !== null || !player.state.active) return;
      lookId = e.pointerId;
      lookLast = { x: e.clientX, y: e.clientY };
    }

    function lookMove(e) {
      if (e.pointerId !== lookId) return;
      player.state.lookDelta.x += (e.clientX - lookLast.x) * LOOK;
      player.state.lookDelta.y += (e.clientY - lookLast.y) * LOOK;
      lookLast = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }

    function lookUp(e) {
      if (e.pointerId !== lookId) return;
      lookId = null;
    }

    pad.addEventListener('pointerdown', stickDown);
    pad.addEventListener('pointermove', stickMove);
    pad.addEventListener('pointerup', stickUp);
    pad.addEventListener('pointercancel', stickUp);

    canvas.addEventListener('pointerdown', lookDown);
    canvas.addEventListener('pointermove', lookMove);
    canvas.addEventListener('pointerup', lookUp);
    canvas.addEventListener('pointercancel', lookUp);

    el.touchUse.addEventListener('click', (e) => {
      e.preventDefault();
      onInteract();
    });

    return {
      /* Shown while walking, hidden at a table -- where the rail's own buttons
         are the controls and a thumbstick would only sit on top of them. */
      setVisible(on) {
        layer.hidden = !on;
        if (!on) {
          player.state.stick.x = 0;
          player.state.stick.y = 0;
          player.state.sprinting = false;
          stickId = null;
          lookId = null;
        }
      },
      get active() { return true; },
    };
  }

  global.GWTouch = { init, coarse };
})(window);
