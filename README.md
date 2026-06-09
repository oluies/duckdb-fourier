# duckdb-fourier

Fourier series as SQL. A square wave is projected onto the orthogonal basis {sin(kx)} in L2, and every number — coefficients, partial sums, errors — is computed by DuckDB running in the browser via [duckdb-wasm](https://github.com/duckdb/duckdb-wasm). Moving a slider re-executes the query.

The repository is a demonstration of two things at once: that orthogonal projection in a Hilbert space is a few lines of SQL, and that DuckDB-Wasm makes a database a reasonable compute engine for interactive pages with no server.

![screenshot](doc/screenshot.png)

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev        # development server
npm run build      # static build in dist/
npm run preview    # serve the build locally
```

The build is self-contained. `dist/` makes no requests to external origins and can be served from any static file server, including offline:

```bash
python -m http.server -d dist 8000
```

## The SQL

Everything below also runs in the DuckDB CLI, unchanged.

Sample the target function on a grid and compute the Fourier coefficients. The coefficient of basis function sin(kx) is the inner product with f divided by the squared norm of the basis function, which in SQL is a `SUM` divided by a `SUM`:

```sql
CREATE TABLE f AS
SELECT i,
       2*pi()*i/1024 AS x,
       CASE WHEN 2*pi()*i/1024 < pi() THEN 1.0 ELSE -1.0 END AS y
FROM generate_series(0, 1023) t(i);

CREATE TABLE coeffs AS
SELECT k, sum(y * sin(k*x)) / sum(sin(k*x)^2) AS c
FROM f, generate_series(1, 49) t(k)
GROUP BY k;
```

Build the partial sum P_K f for a truncation K and measure the result. The L2 error and the captured energy (Parseval's identity) are window aggregates over the same CTE, so one statement returns both the curve and the statistics:

```sql
WITH terms AS (
  SELECT f.i, f.x, f.y, c.c * sin(c.k * f.x) AS term
  FROM f JOIN coeffs c ON c.k <= 9          -- K = 9
), p AS (
  SELECT i, any_value(x) AS x, any_value(y) AS y, sum(term) AS approx
  FROM terms GROUP BY i
)
SELECT i, x, y, approx,
       sqrt(sum((y - approx)^2) OVER () * 2*pi()/1024) AS l2_error,
       sum(approx^2) OVER () / sum(y^2) OVER ()       AS energy
FROM p ORDER BY i;
```

The orthogonality of the basis can be verified as a Gram matrix using DuckDB's fixed-size arrays. Each basis function becomes one `FLOAT[1024]` value, and `array_inner_product` computes the pairwise inner products:

```sql
CREATE TABLE basis AS
SELECT k, array_agg(sin(k*x) ORDER BY i)::FLOAT[1024] AS v
FROM f, generate_series(1, 6) t(k)
GROUP BY k;

SELECT a.k AS j, b.k AS k,
       round(array_inner_product(a.v, b.v), 2) AS ip
FROM basis a JOIN basis b ON a.k <= b.k
ORDER BY j, k;
```

The output is approximately 512 on the diagonal (n/2) and 0 off the diagonal.

## Checking the numbers

The square wave has the closed-form series (4/pi) * sum over odd k of sin(kx)/k. Two consequences serve as tests:

- At K = 1, the captured energy is 8/pi^2, approximately 81.06%. The query above returns this value.
- Even coefficients are zero, so the L2 error only decreases when K passes an odd integer.

The overshoot visible at the jumps is the Gibbs phenomenon. Its height (about 9% of the jump) does not decrease as K grows, while the L2 error tends to zero. This is the difference between pointwise convergence and convergence in norm, and it is the reason L2 — rather than a space of pointwise limits — is the natural setting for Fourier series.

## Why this is a Hilbert space

L2([0, 2pi)) is a vector space with the inner product <f, g> = integral of f(x)g(x) dx, and it is complete in the induced norm (the Riesz-Fischer theorem). Completeness is what the demo exercises: Parseval bounds the coefficient sums, which makes the partial sums a Cauchy sequence, and completeness guarantees that this sequence converges to an element of the space. The discrete version computed here, R^1024 with a weighted dot product, is a finite-dimensional inner product space and therefore complete automatically; it approximates the continuous object as the grid is refined.

## duckdb-wasm integration

The app bundles duckdb-wasm from npm rather than loading it from a CDN, using explicit local URLs for the wasm and worker assets:

```js
import * as duckdb from "@duckdb/duckdb-wasm";
import wasmUrl from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import workerUrl from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const bundle = await duckdb.selectBundle({
  eh: { mainModule: wasmUrl, mainWorker: workerUrl },
});
const worker = new Worker(bundle.mainWorker);
const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
await db.instantiate(bundle.mainModule);
const conn = await db.connect();
```

Query results arrive as Apache Arrow tables:

```js
const result = await conn.query(sql);
const rows = result.toArray();           // array of row proxies
const first = rows[0];
console.log(Number(first.l2_error));     // Arrow numerics may need Number()
```

Slider input fires faster than queries complete, so results are guarded with a run counter and stale responses are discarded.

## Project structure

```
index.html        page markup
src/main.js       wiring: slider, selector, stats
src/sql.js        DuckDB setup and queries
src/plot.js       canvas rendering
src/style.css     styles
```

## License

MIT
