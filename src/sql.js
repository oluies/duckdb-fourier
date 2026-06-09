// DuckDB-Wasm setup and the SQL that does all the math.
//
// The bundle is selected manually from assets resolved by Vite's `?url` imports,
// so the wasm and worker are served from this origin. We never call
// getJsDelivrBundles(); nothing is fetched from a CDN at runtime.
import * as duckdb from "@duckdb/duckdb-wasm";

import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const MANUAL_BUNDLES = {
  mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
  eh: { mainModule: ehWasm, mainWorker: ehWorker },
};

export const N = 1024;

// x sampled on the grid [0, 2pi); spelled out so each statement is valid in the
// DuckDB CLI verbatim.
const X = `2*pi()*i/${N}`;

// Target functions, all odd about pi so they have a pure sine series.
export const TARGETS = {
  square: {
    label: "square wave",
    expr: `CASE WHEN ${X} < pi() THEN 1.0 ELSE -1.0 END`,
  },
  sawtooth: {
    label: "sawtooth wave",
    // (2pi i/N)/pi - 1, shifted to be odd about pi.
    expr: `CASE WHEN ${X} < pi() THEN (${X})/pi() ELSE (${X})/pi() - 2 END`,
  },
  triangle: {
    label: "triangle wave",
    // Odd triangle on [0, 2pi), amplitude 1: up to 1 by pi/2, down to -1 by
    // 3pi/2, back to 0 at 2pi.
    expr: `CASE WHEN ${X} < pi()/2 THEN (2/pi())*(${X})
            WHEN ${X} < 3*pi()/2 THEN 2 - (2/pi())*(${X})
            ELSE (2/pi())*(${X}) - 4 END`,
  },
};

export function setupStatements(targetKey) {
  const expr = TARGETS[targetKey].expr;
  return [
    `CREATE TABLE f AS
SELECT i,
       ${X} AS x,
       ${expr} AS y
FROM generate_series(0, ${N - 1}) t(i)`,
    `CREATE TABLE coeffs AS
SELECT k, sum(y * sin(k*x)) / sum(sin(k*x)^2) AS c
FROM f, generate_series(1, 49) t(k)
GROUP BY k`,
  ];
}

export function queryFor(K) {
  return `WITH terms AS (
  SELECT f.i, f.x, f.y, c.c * sin(c.k * f.x) AS term
  FROM f JOIN coeffs c ON c.k <= ${K}
), p AS (
  SELECT i, any_value(x) AS x, any_value(y) AS y, sum(term) AS approx
  FROM terms GROUP BY i
)
SELECT i, x, y, approx,
       sqrt(sum((y - approx)^2) OVER () * 2*pi()/${N}) AS l2_error,
       sum(approx^2) OVER () / sum(y^2) OVER ()       AS energy
FROM p ORDER BY i`;
}

let db = null;
let conn = null;

// Serialize all DB access. A table rebuild drops `coeffs`/`f` before recreating
// them; without a mutex a projection query could be submitted into that window
// and fail with "Table coeffs does not exist". Each task runs to completion
// before the next starts, so a rebuild is atomic w.r.t. projection queries.
let chain = Promise.resolve();
function serialize(task) {
  const next = chain.then(task, task);
  // Keep the chain alive even if a task rejects.
  chain = next.catch(() => {});
  return next;
}

export async function initDuckDB() {
  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker);
  db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  conn = await db.connect();
  return db.getVersion();
}

// Drop and recreate both tables for the chosen target, as one critical section.
export function buildTables(targetKey) {
  return serialize(async () => {
    await conn.query("DROP TABLE IF EXISTS coeffs");
    await conn.query("DROP TABLE IF EXISTS f");
    for (const stmt of setupStatements(targetKey)) {
      await conn.query(stmt);
    }
  });
}

// Execute the projection query for K, timing it. All statistics come from SQL.
export function runProjection(K) {
  return serialize(() => projectionTask(K));
}

async function projectionTask(K) {
  const sql = queryFor(K);
  const t0 = performance.now();
  const result = await conn.query(sql);
  const durationMs = performance.now() - t0;
  const arr = result.toArray();
  const rows = arr.map((r) => ({
    x: Number(r.x),
    y: Number(r.y),
    approx: Number(r.approx),
  }));
  const first = arr[0];
  return {
    sql,
    durationMs,
    rows,
    l2Error: Number(first.l2_error),
    energy: Number(first.energy),
  };
}
