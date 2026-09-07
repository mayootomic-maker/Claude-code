package dev.understudy.mc;

/**
 * The control panel, as one page.
 *
 * Held as a string rather than a resource file for a dull but decisive reason:
 * a resource has to be found at runtime, and "the panel is blank" caused by a
 * path that is right in a development run and wrong inside a remapped jar is
 * exactly the sort of failure this mod has spent a lot of effort not having.
 * A constant cannot be missing.
 *
 * Nothing is loaded from the internet — no font, no framework, no icon. It
 * works with the network cable out, which for a thing whose entire job is to
 * talk to a game on this machine is the only sensible arrangement.
 *
 * On the look. Minecraft's interface is a bevel: a lit edge on the top and
 * left, a shadowed one on the bottom and right, no rounded corners, and type
 * that lines up in columns. All of that is kept, because it is what makes it
 * feel like part of the game. What is added is everything the game could not
 * do in 2011 — real depth, a glow on the things that matter, bars that animate,
 * and a layout that reflows onto a phone, which is where a remote control
 * actually gets used.
 */
final class Panel {
    private Panel() {}

    static String html() {
        return PAGE;
    }

    private static final String PAGE = """
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>Understudy</title>
<style>
:root{
  --void:#080b0a; --deep:#0d1211; --panel:#141b19; --raise:#1b2422;
  --edge-lit:#2b3a35; --edge-dim:#050807;
  --ink:#dfe9e5; --ink-dim:#8ba099; --ink-faint:#5b6f68;
  --go:#4ade80; --go-glow:#4ade8033; --warn:#e8a33d; --bad:#ff5b5b;
  --gold:#ffd964; --cyan:#5bd6ff;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;background:var(--void);color:var(--ink);font-family:var(--sans);
  font-size:14px;line-height:1.45;-webkit-font-smoothing:antialiased;
  background-image:
    repeating-linear-gradient(0deg,#ffffff04 0 1px,transparent 1px 3px),
    radial-gradient(1200px 600px at 50% -10%,#12211c 0%,transparent 70%);
}
/* The Minecraft bevel, sharpened: a lit edge and a shadowed one, no radius. */
.bevel{border:2px solid var(--edge-dim);border-top-color:var(--edge-lit);
  border-left-color:var(--edge-lit);background:var(--panel)}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}

header{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:14px;
  padding:10px 16px;background:linear-gradient(180deg,#101917 0%,#0b100ee6 100%);
  border-bottom:2px solid var(--edge-dim);backdrop-filter:blur(8px)}
.brand{font-family:var(--mono);font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  font-size:13px;color:var(--go);text-shadow:0 0 12px var(--go-glow)}
.brand span{color:var(--ink-faint)}
.link{display:flex;align-items:center;gap:7px;font-family:var(--mono);font-size:11px;
  color:var(--ink-dim);text-transform:uppercase;letter-spacing:.1em}
.dot{width:8px;height:8px;background:var(--bad);box-shadow:0 0 10px var(--bad)}
.live .dot{background:var(--go);box-shadow:0 0 10px var(--go);animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.45}}
.spacer{flex:1}
button{font:inherit;color:inherit;cursor:pointer;background:var(--raise);
  border:2px solid var(--edge-dim);border-top-color:var(--edge-lit);
  border-left-color:var(--edge-lit);padding:8px 14px;font-family:var(--mono);font-size:12px;
  text-transform:uppercase;letter-spacing:.08em;transition:background .12s,transform .06s}
button:hover:not(:disabled){background:#243230}
button:active:not(:disabled){transform:translateY(1px);
  border-color:var(--edge-lit);border-top-color:var(--edge-dim);border-left-color:var(--edge-dim)}
button:disabled{opacity:.35;cursor:not-allowed}
button.go{background:#15301f;border-top-color:#2f6b47;border-left-color:#2f6b47;color:var(--go)}
button.go:hover:not(:disabled){background:#1c422a}
button.stop{background:#3a1416;border-top-color:#7e2c2f;border-left-color:#7e2c2f;
  color:#ffb3b3;font-weight:700}
button.stop:hover:not(:disabled){background:#511a1e}

main{display:grid;grid-template-columns:300px minmax(0,1fr) 320px;gap:14px;
  padding:14px;max-width:1500px;margin:0 auto;align-items:start}
@media(max-width:1180px){main{grid-template-columns:1fr 1fr}.wide{grid-column:1/-1}}
@media(max-width:760px){main{grid-template-columns:1fr;padding:10px;gap:10px}}

section{padding:12px}
h2{margin:0 0 10px;font-family:var(--mono);font-size:10px;letter-spacing:.18em;
  text-transform:uppercase;color:var(--ink-faint);display:flex;gap:8px;align-items:center}
h2::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--edge-lit),transparent)}

/* Vitals: ten pips a bar, the way the game counts them. */
.bar{display:flex;gap:3px;margin:3px 0 10px}
.pip{width:100%;height:9px;background:#1e2725;border:1px solid #0a0e0d;position:relative}
.pip.on{background:var(--bad);box-shadow:0 0 6px #ff5b5b55}
.pip.half{background:linear-gradient(90deg,var(--bad) 50%,#1e2725 50%)}
.food .pip.on{background:var(--warn);box-shadow:0 0 6px #e8a33d55}
.armour .pip.on{background:var(--cyan);box-shadow:0 0 6px #5bd6ff55}
.tag{font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;
  color:var(--ink-faint);display:flex;justify-content:space-between}

.rows{display:grid;gap:6px}
.row{display:flex;justify-content:space-between;gap:10px;font-family:var(--mono);font-size:12px;
  padding:5px 8px;background:#0f1614;border-left:2px solid var(--edge-lit)}
.row b{color:var(--ink);font-weight:600}
.row span{color:var(--ink-dim)}

.doing{padding:12px;background:linear-gradient(135deg,#132019,#0e1614);
  border-left:3px solid var(--go);margin-bottom:10px}
.doing .what{font-family:var(--mono);font-size:15px;color:var(--go);
  text-shadow:0 0 14px var(--go-glow);word-break:break-word}
.doing .because{font-size:12px;color:var(--ink-dim);margin-top:5px}
.doing.idle{border-left-color:var(--edge-lit)}
.doing.idle .what{color:var(--ink-faint);text-shadow:none}
.doing.fighting{border-left-color:var(--bad);background:linear-gradient(135deg,#22100f,#150c0c)}
.doing.fighting .what{color:#ff9a9a;text-shadow:0 0 14px #ff5b5b44}

.tabs{display:flex;gap:2px;margin-bottom:10px;flex-wrap:wrap}
.tabs button{flex:1;min-width:72px;padding:7px 6px;font-size:11px}
.tabs button[aria-selected=true]{background:#1d302a;color:var(--go);
  border-top-color:#2f6b47;border-left-color:#2f6b47}
.pane{display:none}.pane.on{display:block}

.field{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap}
input,select{flex:1;min-width:0;font:inherit;font-family:var(--mono);font-size:13px;
  background:#0b100f;color:var(--ink);border:2px solid var(--edge-dim);
  border-top-color:#000;border-left-color:#000;padding:8px 10px}
input:focus,select:focus{outline:none;border-color:var(--go);box-shadow:0 0 0 2px var(--go-glow)}
input.n{flex:0 0 88px}
.hint{font-size:11px;color:var(--ink-faint);margin:-2px 0 10px}

.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:6px}
.slot{background:#0f1614;border:2px solid var(--edge-dim);border-top-color:#222c29;
  padding:7px 8px;font-family:var(--mono);font-size:11px;overflow:hidden}
.slot .n{color:var(--gold);font-size:15px;font-weight:700;display:block}
.slot .k{color:var(--ink-dim);display:block;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}

.card{background:#0f1614;border:2px solid var(--edge-dim);border-top-color:#222c29;
  padding:10px;margin-bottom:8px;cursor:pointer;transition:border-color .12s,background .12s}
.card:hover{background:#141d1a;border-top-color:var(--go);border-left-color:var(--go)}
.card h3{margin:0 0 4px;font-family:var(--mono);font-size:13px;color:var(--ink)}
.card p{margin:0;font-size:12px;color:var(--ink-dim)}

.steps{display:grid;gap:4px;margin-top:8px}
.step{display:flex;gap:8px;align-items:baseline;font-family:var(--mono);font-size:12px;
  padding:4px 8px;background:#0d1312}
.step.done{color:var(--ink-faint)}
.step.done .mark{color:var(--go)}
.step .mark{width:12px;color:var(--ink-faint)}

#log{height:260px;overflow-y:auto;font-family:var(--mono);font-size:11.5px;
  background:#080c0b;border:2px solid var(--edge-dim);border-top-color:#000;padding:8px;
  display:flex;flex-direction:column-reverse;gap:2px}
#log div{color:var(--ink-dim);word-break:break-word;padding:1px 0}
#log div.new{color:var(--ink)}
#log div.warn{color:var(--warn)}

.meter{display:grid;grid-template-columns:78px 1fr 46px;gap:8px;align-items:center;
  font-family:var(--mono);font-size:11px;margin-bottom:5px}
.meter .track{height:8px;background:#0e1413;border:1px solid #000}
.meter .fill{height:100%;background:linear-gradient(90deg,var(--go),#2f9c5c)}
.meter .pct{text-align:right;color:var(--ink-dim)}

.toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:50;
  background:#15201d;border:2px solid var(--edge-dim);border-top-color:var(--go);
  padding:10px 18px;font-family:var(--mono);font-size:12px;color:var(--go);
  opacity:0;pointer-events:none;transition:opacity .2s}
.toast.on{opacity:1}
.offline{padding:22px;text-align:center;color:var(--ink-dim);font-family:var(--mono);font-size:12px}
.offline b{display:block;color:var(--bad);font-size:14px;margin-bottom:8px}
kbd{font-family:var(--mono);font-size:10px;background:#0b100f;border:1px solid var(--edge-lit);
  padding:1px 5px;color:var(--ink-faint)}
</style></head>
<body>
<header>
  <div class="brand">Under<span>study</span></div>
  <div class="link" id="link"><i class="dot"></i><span id="linkText">connecting</span></div>
  <div class="spacer"></div>
  <button id="pause" title="Hold everything where it is">Pause</button>
  <button class="stop" id="stopAll" title="Stop everything (Esc)">Stop</button>
</header>

<main>
  <div>
    <section class="bevel" id="vitals">
      <h2>Vitals</h2>
      <div class="tag"><span>Health</span><span class="mono" id="hpText">--</span></div>
      <div class="bar" id="hp"></div>
      <div class="tag"><span>Food</span><span class="mono" id="foodText">--</span></div>
      <div class="bar food" id="food"></div>
      <div class="tag"><span>Armour</span><span class="mono" id="armText">--</span></div>
      <div class="bar armour" id="arm"></div>
      <div class="rows">
        <div class="row"><span>Position</span><b id="pos">--</b></div>
        <div class="row"><span>Dimension</span><b id="dim">--</b></div>
        <div class="row"><span>Light</span><b id="light">--</b></div>
        <div class="row"><span>Weapon</span><b id="weapon">--</b></div>
      </div>
    </section>

    <section class="bevel" style="margin-top:14px">
      <h2>Remembers</h2>
      <div class="rows" id="atlas"><div class="row"><span>nothing yet</span><b>0</b></div></div>
    </section>
  </div>

  <div class="wide">
    <section class="bevel">
      <h2>Doing</h2>
      <div class="doing idle" id="doing">
        <div class="what" id="what">not connected</div>
        <div class="because" id="because"></div>
      </div>
      <div class="steps" id="steps"></div>
    </section>

    <section class="bevel" style="margin-top:14px">
      <h2>Tell it to</h2>
      <div class="tabs" role="tablist">
        <button role="tab" data-pane="get" aria-selected="true">Get</button>
        <button role="tab" data-pane="build" aria-selected="false">Build</button>
        <button role="tab" data-pane="project" aria-selected="false">Project</button>
        <button role="tab" data-pane="go" aria-selected="false">Travel</button>
        <button role="tab" data-pane="more" aria-selected="false">More</button>
      </div>

      <div class="pane on" id="pane-get">
        <div class="field">
          <input id="getName" list="items" placeholder="iron_ingot, or iron_ingot+coal" autocomplete="off">
          <input id="getN" class="n mono" type="number" min="1" max="4096" value="16">
          <button class="go" id="getGo">Go</button>
        </div>
        <datalist id="items"></datalist>
        <p class="hint">Join names with <b>+</b> and it plans them as one trip rather than two
          down the same tunnel.</p>
        <div class="field">
          <button data-quick="iron_ingot">iron</button>
          <button data-quick="coal">coal</button>
          <button data-quick="diamond">diamond</button>
          <button data-quick="oak_log">wood</button>
          <button data-quick="cooked_beef">food</button>
          <button data-quick="torch">torches</button>
        </div>
      </div>

      <div class="pane" id="pane-build"><div id="designs"></div></div>
      <div class="pane" id="pane-project"><div id="projects"></div></div>

      <div class="pane" id="pane-go">
        <div class="field">
          <input id="gx" class="mono" type="number" placeholder="x">
          <input id="gy" class="mono" type="number" placeholder="y" value="64">
          <input id="gz" class="mono" type="number" placeholder="z">
          <button class="go" id="goGo">Walk</button>
        </div>
        <p class="hint">It walks. It does not teleport — the route is the same one you
          would take, and it can be interrupted at any moment.</p>
      </div>

      <div class="pane" id="pane-more">
        <div class="field">
          <button id="sortGo">Sort into chests</button>
          <button id="enchGo">Enchant best</button>
          <button id="hudGo">Toggle overlay</button>
        </div>
        <div class="field">
          <input id="autoName" placeholder="auto goal, e.g. diamond" autocomplete="off">
          <input id="autoN" class="n mono" type="number" min="1" value="8">
          <button class="go" id="autoGo">Auto</button>
          <button id="autoOff">Auto off</button>
        </div>
        <div class="field">
          <select id="speed">
            <option value="steady">Build steady</option>
            <option value="brisk">Build brisk</option>
            <option value="flat_out">Build flat out</option>
          </select>
          <button id="speedGo">Set</button>
        </div>
      </div>
    </section>

    <section class="bevel" style="margin-top:14px">
      <h2>Carrying</h2>
      <div class="grid" id="carried"></div>
    </section>
  </div>

  <div>
    <section class="bevel">
      <h2>Said</h2>
      <div id="log"></div>
    </section>
    <section class="bevel" style="margin-top:14px">
      <h2>Where the time goes</h2>
      <div id="timing"><p class="hint">Nothing timed yet.</p></div>
    </section>
    <section class="bevel" style="margin-top:14px">
      <h2>What things cost here</h2>
      <div id="costs"><p class="hint">It learns as it gathers.</p></div>
    </section>
  </div>
</main>

<div class="toast" id="toast"></div>

<script>
const key = new URLSearchParams(location.search).get("k") || "";
const $ = id => document.getElementById(id);
let live = false, seenLog = 0;

function toast(text, bad) {
  const box = $("toast");
  box.textContent = text;
  box.style.color = bad ? "var(--bad)" : "var(--go)";
  box.style.borderTopColor = bad ? "var(--bad)" : "var(--go)";
  box.classList.add("on");
  clearTimeout(box._t);
  box._t = setTimeout(() => box.classList.remove("on"), 2200);
}

async function tell(params) {
  if (!key) return toast("no token in the address", true);
  try {
    const reply = await fetch("/do?k=" + encodeURIComponent(key) + "&" + params, {method: "POST"});
    const body = await reply.json();
    if (body.error) toast(body.error, true); else toast("sent");
  } catch (problem) { toast("could not reach the game", true); }
}

function pips(into, value, max) {
  const box = $(into);
  const want = 10;
  let html = "";
  for (let at = 0; at < want; at++) {
    const from = (at / want) * max, span = max / want;
    const got = Math.max(0, Math.min(span, value - from)) / span;
    html += '<i class="pip' + (got > .75 ? " on" : got > .25 ? " half" : "") + '"></i>';
  }
  box.innerHTML = html;
}

function rows(into, pairs, empty) {
  const box = $(into);
  if (!pairs.length) { box.innerHTML = '<div class="row"><span>' + empty + '</span><b>0</b></div>'; return; }
  box.innerHTML = pairs.map(([k, v]) =>
    '<div class="row"><span>' + esc(k) + '</span><b>' + esc(String(v)) + '</b></div>').join("");
}

const esc = text => String(text).replace(/[<>&"]/g, c =>
  ({"<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;"})[c]);

function paint(state) {
  setLive(true);
  pips("hp", state.health, state.maxHealth || 20);
  pips("food", state.food, 20);
  pips("arm", state.armour, 20);
  $("hpText").textContent = Math.round(state.health * 10) / 10 + " / " + (state.maxHealth || 20);
  $("foodText").textContent = state.food + " / 20";
  $("armText").textContent = state.armour + " / 20";
  $("pos").textContent = state.x + " " + state.y + " " + state.z;
  $("dim").textContent = state.dimension || "--";
  $("light").textContent = state.light;
  $("weapon").textContent = state.weapon || "bare hands";

  const doing = $("doing");
  doing.className = "doing" + (state.fight ? " fighting" : state.busy ? "" : " idle");
  $("what").textContent = state.paused ? "paused" : (state.doing || "idle");
  $("because").textContent = state.fight || state.why || "";

  $("steps").innerHTML = (state.steps || []).map(line => {
    const done = line.startsWith("  done");
    return '<div class="step' + (done ? " done" : "") + '"><span class="mark">' +
      (done ? "✔" : "·") + "</span><span>" + esc(line.replace(/^\\s*(done|to do)\\s*/, "")) +
      "</span></div>";
  }).join("");

  const bag = Object.entries(state.carried || {}).sort((a, b) => b[1] - a[1]);
  $("carried").innerHTML = bag.length ? bag.map(([item, n]) =>
    '<div class="slot"><span class="n">' + n + '</span><span class="k">' +
    esc(item.replace(/_/g, " ")) + "</span></div>").join("")
    : '<p class="hint">Nothing on you.</p>';

  rows("atlas", Object.entries(state.atlas || {}).sort((a, b) => b[1] - a[1]).slice(0, 10),
       "nothing remembered yet");

  const log = $("log");
  const lines = state.log || [];
  if (lines.length !== seenLog) {
    seenLog = lines.length;
    log.innerHTML = lines.slice().reverse().map((line, at) =>
      '<div class="' + (at === 0 ? "new" : "") + '">' + esc(line) + "</div>").join("");
  }

  $("timing").innerHTML = (state.timing || []).length
    ? state.timing.map(t => meter(t.phase, t.share, Math.round(t.seconds) + "s")).join("")
    : '<p class="hint">Nothing timed yet.</p>';

  $("costs").innerHTML = (state.costs || []).length
    ? state.costs.map(c => '<div class="meter"><span>' + esc(c.item.slice(0, 11)) +
        '</span><span class="track"></span><span class="pct">' +
        (Math.round(c.seconds * 10) / 10) + "s</span></div>").join("")
    : '<p class="hint">It learns as it gathers.</p>';

  if (!$("designs").dataset.filled && state.designs) {
    $("designs").dataset.filled = "1";
    $("designs").innerHTML = state.designs.map(d =>
      '<div class="card" data-build="' + esc(d.id) + '" data-size="' + d.size + '"><h3>' +
      esc(d.name) + "</h3><p>" + esc(d.summary) + "</p></div>").join("");
  }
  if (!$("projects").dataset.filled && state.projects) {
    $("projects").dataset.filled = "1";
    $("projects").innerHTML = state.projects.map(p =>
      '<div class="card" data-project="' + esc(p.id) + '"><h3>' + esc(p.name) +
      "</h3><p>" + esc(p.summary) + "</p></div>").join("");
  }
  if (!$("items").dataset.filled && state.obtainable) {
    $("items").dataset.filled = "1";
    $("items").innerHTML = state.obtainable.map(i => "<option value=\\"" + esc(i) + "\\">").join("");
  }
  $("pause").textContent = state.paused ? "Resume" : "Pause";
}

const meter = (label, share, right) =>
  '<div class="meter"><span>' + esc(label) + '</span><span class="track">' +
  '<span class="fill" style="width:' + Math.round(share * 100) + '%"></span></span>' +
  '<span class="pct">' + esc(right) + "</span></div>";

function setLive(now) {
  if (now === live) return;
  live = now;
  $("link").classList.toggle("live", now);
  $("linkText").textContent = now ? "connected" : "no game";
  document.querySelectorAll("button").forEach(b => b.disabled = !now);
}

async function poll() {
  try {
    const reply = await fetch("/state?k=" + encodeURIComponent(key), {cache: "no-store"});
    if (!reply.ok) throw new Error("refused");
    paint(await reply.json());
  } catch (problem) {
    setLive(false);
    $("what").textContent = key ? "not connected" : "no token in the address";
    $("because").textContent = key
      ? "the game is not answering — is Minecraft still running?"
      : "open the link the mod printed in chat, token and all";
  }
}

document.querySelectorAll("[role=tab]").forEach(tab => tab.onclick = () => {
  document.querySelectorAll("[role=tab]").forEach(t =>
    t.setAttribute("aria-selected", String(t === tab)));
  document.querySelectorAll(".pane").forEach(p =>
    p.classList.toggle("on", p.id === "pane-" + tab.dataset.pane));
});

$("stopAll").onclick = () => tell("a=stop");
$("pause").onclick = () => tell($("pause").textContent === "Pause" ? "a=pause" : "a=resume");
$("getGo").onclick = () => tell("a=get&name=" + encodeURIComponent($("getName").value) +
  "&n=" + $("getN").value);
$("getName").onkeydown = e => { if (e.key === "Enter") $("getGo").click(); };
$("goGo").onclick = () => tell("a=travel&x=" + ($("gx").value | 0) + "&y=" + ($("gy").value | 0) +
  "&z=" + ($("gz").value | 0));
$("sortGo").onclick = () => tell("a=sort");
$("enchGo").onclick = () => tell("a=enchant");
$("hudGo").onclick = () => tell("a=hud");
$("autoGo").onclick = () => tell("a=auto&name=" + encodeURIComponent($("autoName").value) +
  "&n=" + $("autoN").value);
$("autoOff").onclick = () => tell("a=auto-off");
$("speedGo").onclick = () => tell("a=speed&name=" + $("speed").value);
document.addEventListener("click", e => {
  const quick = e.target.closest("[data-quick]");
  if (quick) { $("getName").value = quick.dataset.quick; $("getGo").click(); }
  const build = e.target.closest("[data-build]");
  if (build) tell("a=build&name=" + build.dataset.build + "&n=" + build.dataset.size);
  const project = e.target.closest("[data-project]");
  if (project) tell("a=project&name=" + project.dataset.project);
});
document.addEventListener("keydown", e => { if (e.key === "Escape") tell("a=stop"); });

poll();
setInterval(poll, 500);
</script>
</body></html>
""";
}
