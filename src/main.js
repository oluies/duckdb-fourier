import { draw } from "./plot.js";
import {
  initDuckDB,
  buildTables,
  runProjection,
  queryFor,
  setupStatements,
  TARGETS,
} from "./sql.js";

const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const statusText = $("status-text");
const slider = $("k");
const kval = $("kval");
const fnGroup = $("fn");
const canvas = $("plot");

let currentTarget = "square";
let runId = 0; // guards against stale async results painting over newer ones
let lastRows = null;

// --- SQL panel rendering ------------------------------------------------------

const KEYWORDS =
  /\b(WITH|SELECT|FROM|JOIN|ON|GROUP BY|ORDER BY|OVER|AS|CASE|WHEN|THEN|ELSE|END|CREATE TABLE)\b/g;

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSql(K, targetKey) {
  // Show the full script: the two CREATE TABLE statements (whose `y` expression
  // depends on the selected target) and the projection query.
  const script =
    setupStatements(targetKey).join(";\n\n") + ";\n\n" + queryFor(K) + ";";
  let html = escapeHtml(script);
  // Highlight the target expression so switching square / sawtooth / triangle
  // visibly changes the SQL, and highlight the K truncation value.
  const exprEsc = escapeHtml(TARGETS[targetKey].expr);
  html = html.replace(exprEsc, () => `<mark>${exprEsc}</mark>`);
  html = html.replace(`c.k &lt;= ${K}`, `c.k &lt;= <mark>${K}</mark>`);
  html = html.replace(KEYWORDS, '<span class="kw">$1</span>');
  $("sqlbox").innerHTML = html;
}

// --- Footnotes ----------------------------------------------------------------

const FOOTNOTES = {
  square:
    "For the square wave the L² error only drops when K passes an odd integer, since every even coefficient is zero. The overshoot at the jumps — the Gibbs phenomenon, about 9% of the jump height — does not vanish as K grows, even though the L² error tends to zero: convergence in norm is not pointwise convergence.",
  sawtooth:
    "The sawtooth has a single jump per period, so like the square wave it shows Gibbs overshoot at the discontinuity that persists as K grows. Its coefficients decay as 1/k, so the L² error falls only slowly with K.",
  triangle:
    "The triangle wave is continuous, so its coefficients decay as 1/k² instead of 1/k. Convergence is visibly faster than for the square or sawtooth, and there is no Gibbs overshoot.",
};

function setFootnote() {
  $("footnote").textContent = FOOTNOTES[currentTarget];
}

// --- Stats + query run --------------------------------------------------------

async function run(K) {
  const myRun = ++runId;
  renderSql(K, currentTarget);
  let res;
  try {
    res = await runProjection(K);
  } catch (err) {
    console.error(err);
    return;
  }
  if (myRun !== runId) return; // a newer run superseded this one

  $("l2").textContent = res.l2Error.toFixed(3);
  $("energy").textContent = (100 * res.energy).toFixed(1) + "%";
  $("qtime").innerHTML = res.durationMs.toFixed(1) + ' <small>ms</small>';
  $("sqltime").textContent = res.durationMs.toFixed(1) + " ms";

  lastRows = res.rows;
  draw(canvas, lastRows);
}

async function selectTarget(key) {
  if (!(key in TARGETS) || key === currentTarget) return;
  currentTarget = key;
  for (const btn of fnGroup.querySelectorAll("button")) {
    btn.classList.toggle("active", btn.dataset.fn === key);
  }
  $("legend-target").textContent = "f, " + TARGETS[key].label;
  setFootnote();
  // Bumping runId invalidates any in-flight projection from the old tables.
  runId++;
  try {
    await buildTables(key);
    await run(parseInt(slider.value, 10));
  } catch (err) {
    console.error(err);
  }
}

// --- Boot ---------------------------------------------------------------------

setFootnote();

window.addEventListener("resize", () => {
  if (lastRows) draw(canvas, lastRows);
});

async function init() {
  try {
    const version = await initDuckDB();
    await buildTables(currentTarget);

    statusEl.classList.add("ready");
    statusText.textContent = `DuckDB ${version} ready · tables f (1024 rows) and coeffs (49 rows) created`;

    slider.disabled = false;
    for (const btn of fnGroup.querySelectorAll("button")) btn.disabled = false;

    slider.addEventListener("input", () => {
      const K = parseInt(slider.value, 10);
      kval.textContent = K;
      run(K);
    });
    fnGroup.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-fn]");
      if (btn && !btn.disabled) selectTarget(btn.dataset.fn);
    });

    await run(parseInt(slider.value, 10));
  } catch (err) {
    console.error(err);
    statusEl.classList.add("error");
    statusText.textContent = "Failed to load DuckDB-Wasm: " + err.message;
  }
}

init();
