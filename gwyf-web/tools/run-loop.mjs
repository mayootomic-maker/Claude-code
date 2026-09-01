/* Play a whole run without a table: does the day loop actually end?

   The tables are exercised by drive.mjs. This is the other half -- quota,
   strikes, interest, the shark taking things, and the three endings -- driven
   straight through the shell so a run that can never finish, or one that
   finishes in a state nobody wrote a screen for, fails here. */

import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Through the front door.

   The game opens on a title screen now, so every harness that used to click
   the briefing's button straight after boot has to press Play first. Kept as
   one function rather than five copies of the same two clicks. */
async function startGame(page) {
  await page.waitForSelector('#title:not([hidden]), [data-go]', { timeout: 60000 });
  const title = await page.$('#title:not([hidden])');
  if (title) {
    await page.click('.titlebtn--primary');
    await page.waitForTimeout(500);
  }
  const go = await page.$('[data-go]');
  if (go) {
    await go.click();
    await page.waitForTimeout(400);
  }
}


const here = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(here, '..', 'gamble-with-your-friends.html');
if (!existsSync(FILE)) { console.error('build it first'); process.exit(1); }

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

/* Getting onto a floor.

   The day does not begin on the briefing screen any more -- that opens the
   lobby, and the five minutes start when you get in the limo. Every scenario
   here drives days rather than rooms, so each one boards the limo itself and
   waits for the floor to finish loading before ending the day on it. Installed
   on the page so all three scenarios call the same one. */
async function installBoarding(page) {
  await page.evaluate(() => {
    window.__onTheFloor = async () => {
      const shell = window.GWShell;
      // Wait for whatever room is already loading before asking for another.
      // Calling boardLimo while the lobby is still building hits the shell's
      // own re-entry guard, does nothing, and leaves the day never started --
      // which reads exactly like the report screen having no way forward.
      const quiet = async () => {
        for (let i = 0; i < 400 && (GWLoading.isOpen() || shell.floorBusy); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      await quiet();
      if (shell.store.s.phase !== 'floor') shell.boardLimo();
      await quiet();
      await new Promise((r) => setTimeout(r, 60));
    };
  });
}

async function play(label, setup) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/fonts\.(googleapis|gstatic)|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/.test(m.text())) return;
    errors.push(m.text());
  });
  await page.goto('file://' + FILE);
  await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
  await startGame(page);
  await page.waitForTimeout(300);
  await installBoarding(page);

  const result = await page.evaluate(async (setupName) => {
    const shell = window.GWShell;
    const log = [];
    shell.store.s.mods.quietFriends = true;
    for (let day = 0; day < 14; day++) {
      const s = shell.store.s;
      if (s.ending) break;
      // How this run pays its quota, or fails to.
      if (setupName === 'pay') s.bank = s.quota * 2 + 10;
      else if (setupName === 'fail') s.bank = 0;
      else s.bank = day < 3 ? s.quota + 5 : 0;
      if (setupName === 'pay' && s.day >= 3) s.debt = 0;

      await window.__onTheFloor();
      shell.endDay();
      await new Promise((r) => setTimeout(r, 120));
      log.push('day ' + s.day + ': strikes ' + s.strikes + ', debt ' + Math.round(s.debt)
        + ', bank ' + Math.round(s.bank));

      const end = document.querySelector('[data-end]');
      const next = document.querySelector('[data-next]');
      if (end) { end.click(); await new Promise((r) => setTimeout(r, 200)); break; }
      if (!next) { log.push('NO WAY FORWARD from the report screen'); break; }
      next.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    return {
      log, ending: shell.store.s.ending,
      title: (document.querySelector('.sheet__title') || {}).textContent || null,
      tickets: shell.store.meta.tickets,
      canRestart: !!document.querySelector('[data-again]'),
    };
  }, setup);

  await page.screenshot({ path: '/tmp/gwshots/run-' + label + '.png' });
  await page.close();
  return { result, errors };
}

let bad = 0;
for (const [label, setup] of [['paid', 'pay'], ['house', 'fail'], ['mixed', 'mixed']]) {
  const { result, errors } = await play(label, setup);
  console.log('\n--- ' + label + ' ---');
  for (const line of result.log) console.log('  ' + line);
  console.log('  ending: ' + (result.ending || 'none') + '   screen: ' + result.title
    + '   tickets: ' + result.tickets + '   restartable: ' + result.canRestart);
  if (!result.ending) { bad++; console.error('  FAIL: the run never ended'); }
  if (result.ending && !result.canRestart) { bad++; console.error('  FAIL: no way to start again'); }
  if (errors.length) { bad++; console.error('  ERRORS: ' + [...new Set(errors)].join(' | ')); }
}

/* Paying the debt off is the good ending, and it has to be reachable by
   actually handing money over rather than by a test setting debt to zero. This
   walks the report screen's own pay buttons. */
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('file://' + FILE);
  await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
  await startGame(page);
  await installBoarding(page);
  const paid = await page.evaluate(async () => {
    const shell = window.GWShell;
    shell.store.s.mods.quietFriends = true;
    const log = [];
    for (let i = 0; i < 8 && !shell.store.s.ending; i++) {
      const s = shell.store.s;
      s.bank = s.quota + s.debt + 500;      // a very good night
      await window.__onTheFloor();
      shell.endDay();
      await new Promise((r) => setTimeout(r, 150));
      const pay = document.querySelectorAll('[data-pay]');
      if (pay.length) {
        pay[pay.length - 1].click();        // "everything you can"
        await new Promise((r) => setTimeout(r, 200));
      }
      log.push('day ' + s.day + ': debt now ' + Math.round(s.debt));
      const end = document.querySelector('[data-end]');
      if (end) { end.click(); await new Promise((r) => setTimeout(r, 200)); break; }
      const next = document.querySelector('[data-next]');
      if (!next) { log.push('NO WAY FORWARD'); break; }
      next.click();
      await new Promise((r) => setTimeout(r, 150));
    }
    return { log, ending: shell.store.s.ending,
             title: (document.querySelector('.sheet__title') || {}).textContent };
  });
  console.log('\n--- paying it off for real ---');
  for (const line of paid.log) console.log('  ' + line);
  console.log('  ending: ' + paid.ending + '   screen: ' + paid.title);
  if (paid.ending !== 'paid') { bad++; console.error('  FAIL: the debt cannot actually be paid off'); }
  if (errs.length) { bad++; console.error('  ERRORS: ' + errs.join(' | ')); }
  await page.screenshot({ path: '/tmp/gwshots/run-paidoff.png' });
  await page.close();
}

// Skipping town is the third ending and is reachable only from day five.
const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto('file://' + FILE);
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('#app:not([hidden])', { timeout: 60000 });
await startGame(page);
await installBoarding(page);
const runner = await page.evaluate(async () => {
  const shell = window.GWShell;
  shell.store.s.mods.quietFriends = true;
  shell.store.s.day = 5;
  shell.store.s.quota = GWConfig.quotaFor(5);
  shell.store.s.bank = shell.store.s.quota + 4000;
  await window.__onTheFloor();
  shell.endDay();
  await new Promise((r) => setTimeout(r, 200));
  const run = document.querySelector('[data-run]');
  if (!run) return { offered: false };
  run.click();
  await new Promise((r) => setTimeout(r, 250));
  return { offered: true, ending: shell.store.s.ending,
           title: (document.querySelector('.sheet__title') || {}).textContent };
});
await page.screenshot({ path: '/tmp/gwshots/run-runner.png' });
console.log('\n--- runner ---\n  offered: ' + runner.offered + '   ending: ' + runner.ending
  + '   screen: ' + runner.title);
if (runner.ending !== 'runner') { bad++; console.error('  FAIL: skipping town did not end the run'); }
if (errs.length) { bad++; console.error('  ERRORS: ' + errs.join(' | ')); }
await page.close();

await browser.close();
console.log('\n' + (bad ? bad + ' PROBLEM(S)' : 'all three endings reachable, no errors'));
process.exitCode = bad ? 1 : 0;
