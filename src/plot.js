// Canvas rendering of the target function and its partial sum.
// 2x devicePixelRatio aware; the caller redraws on resize by holding the last
// rows and calling draw() again.

const TARGET_COLOR = "#8A8980";
const ACCENT_COLOR = "#5247C7";
const AXIS_COLOR = "#E4E3DB";
const GUIDE_COLOR = "#CFCEC4";

export function draw(canvas, rows) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!rows || rows.length === 0) return;

  const pad = { l: 10, r: 10, t: 16, b: 16 };
  const ymin = -1.6;
  const ymax = 1.6;
  const X = (i) => pad.l + ((w - pad.l - pad.r) * i) / (rows.length - 1);
  const Y = (v) => pad.t + ((h - pad.t - pad.b) * (ymax - v)) / (ymax - ymin);

  // Zero axis.
  ctx.strokeStyle = AXIS_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.l, Y(0));
  ctx.lineTo(w - pad.r, Y(0));
  ctx.stroke();

  // Dashed guides at y = ±1.
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.setLineDash([3, 4]);
  for (const v of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(v));
    ctx.lineTo(w - pad.r, Y(v));
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Target function in gray.
  ctx.strokeStyle = TARGET_COLOR;
  ctx.lineWidth = 2;
  trace(ctx, rows, (r) => r.y, X, Y);

  // Partial sum in the accent color.
  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 2.25;
  trace(ctx, rows, (r) => r.approx, X, Y);
}

function trace(ctx, rows, valueOf, X, Y) {
  ctx.beginPath();
  rows.forEach((r, i) => {
    const px = X(i);
    const py = Y(valueOf(r));
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
}
