/* Loading screens.

   Two jobs. The obvious one is covering the second or two it takes to build a
   floor -- geometry, materials, four machines. The real one is that a lift
   between floors of a tower should feel like a lift between floors of a tower,
   so the screen names the floor you are arriving at, says what is on it, and
   holds for a beat even when the build was instant. A load that flashes past
   reads as a glitch; one that lands reads as a journey.

   It is a real progress bar over real work, not a timer pretending to be one:
   the caller reports each step as it finishes. */

(function (global) {
  'use strict';

  const MIN_VISIBLE = 900;      // ms, so an instant build still reads as arrival

  const TIPS = [
    'Your friends can spend the account. They will not ask first.',
    'Every table prints what the house takes. Read it once.',
    'Seven comes up more than any other total. That is the whole trick.',
    'The lift only stops at floors the bank can afford.',
    'Shout at someone about to go all in. You get three a day.',
    'Cashing out early is a decision. Not cashing out is also a decision.',
    'The Chamber does not need a house edge.',
    'Tickets survive a wipe. Nothing else does.',
    'A missed quota costs you something you cannot buy back.',
    'The middle of the plinko board is where the money is not.',
  ];

  let node = null;
  let shownAt = 0;
  let steps = 0;
  let done = 0;

  function ensure() {
    if (node) return node;
    node = global.document.createElement('div');
    node.className = 'loading';
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    node.innerHTML =
      '<div class="loading__inner">'
      + '<span class="loading__eyebrow" data-eyebrow></span>'
      + '<span class="loading__floor" data-floor></span>'
      + '<h2 class="loading__title" data-title></h2>'
      + '<p class="loading__blurb" data-blurb></p>'
      + '<div class="loading__bar"><i data-fill></i></div>'
      + '<p class="loading__step" data-step></p>'
      + '<p class="loading__tip" data-tip></p>'
      + '</div>';
    global.document.body.appendChild(node);
    return node;
  }

  /* Open the screen. `total` is how many steps the caller will report. */
  function show(spec) {
    const el = ensure();
    el.style.setProperty('--load-accent', spec.accent || '#d9a441');
    el.querySelector('[data-eyebrow]').textContent = spec.eyebrow || 'Now arriving';
    el.querySelector('[data-floor]').textContent = spec.floor === undefined ? '' : spec.floor;
    el.querySelector('[data-title]').textContent = spec.title || '';
    el.querySelector('[data-blurb]').textContent = spec.blurb || '';
    el.querySelector('[data-tip]').textContent = spec.tip
      || TIPS[Math.floor(Math.random() * TIPS.length)];
    el.querySelector('[data-fill]').style.width = '0%';
    el.querySelector('[data-step]').textContent = '';
    el.classList.remove('is-going');
    el.hidden = false;
    shownAt = global.performance.now();
    steps = Math.max(1, spec.steps || 1);
    done = 0;
  }

  /* Report a finished step. The label says what was actually done. */
  function step(label) {
    if (!node) return;
    done = Math.min(done + 1, steps);
    node.querySelector('[data-fill]').style.width = (done / steps * 100).toFixed(0) + '%';
    node.querySelector('[data-step]').textContent = label || '';
  }

  /* Close, but never sooner than MIN_VISIBLE after opening. */
  function hide() {
    if (!node) return Promise.resolve();
    const el = node;
    el.querySelector('[data-fill]').style.width = '100%';
    const waited = global.performance.now() - shownAt;
    const remaining = Math.max(0, MIN_VISIBLE - waited);
    return new Promise((resolve) => {
      global.setTimeout(() => {
        el.classList.add('is-going');
        global.setTimeout(() => { el.hidden = true; resolve(); }, 320);
      }, remaining);
    });
  }

  const isOpen = () => !!node && !node.hidden;

  global.GWLoading = { show, step, hide, isOpen, TIPS };
})(window);
