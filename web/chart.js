/**
 * Das Jahresdiagramm.
 *
 * Bewusst ohne Bibliothek: eine Linie, eine Referenzkurve und eine Fläche
 * dazwischen sind rund 150 Zeilen Canvas. Eine Diagrammbibliothek wäre die
 * grösste Abhängigkeit des ganzen Projekts und müsste zehn Jahre gepflegt sein.
 *
 * Farben werden aus den CSS-Rollen gelesen, nicht hart kodiert — damit folgt
 * das Diagramm dem Hell/Dunkel-Umschalter ohne eigene Logik.
 */

const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const PAD = { top: 16, right: 14, bottom: 28, left: 42 };

function role(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Erster Tagesindex jedes Monats im gegebenen Jahr. */
function monthStarts(year) {
  const out = [];
  for (let m = 0; m < 12; m++) {
    out.push({ label: MONTHS[m], day: Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86_400_000) });
  }
  return out;
}

/**
 * Zeichnet den Jahresverlauf.
 *
 * `compare` ist optional und trägt einen zweiten Klimastand — dieselbe
 * Tagesachse, dieselbe Temperaturskala. Die Überschreitungsfläche bleibt der
 * Basisreihe vorbehalten: zwei überlagerte Flächen ergeben eine dritte,
 * bedeutungslose Farbe, und die Fläche ist ein Zustand, keine Serie. Die
 * Vergleichsreihe bringt ihre eigene Komfortgrenze mit — das adaptive Band
 * verschiebt sich mit dem Aussenklima, und ohne sie läse man die
 * Überschreitung des Szenarios an der falschen Schwelle ab.
 */
export function drawChart(canvas, state) {
  const { dailyMax, limit, year, compare } = state;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  // Sollhöhe aus `data-height`, nicht aus dem `height`-Attribut: Letzteres
  // schreibt die Zeile weiter unten selbst auf cssHeight · dpr. Von dort
  // wieder gelesen verdoppelte sich das Diagramm bei jedem Neuzeichnen —
  // auf einem Bildschirm mit dpr 2 schon beim ersten Reglerzug.
  const cssHeight = Number(canvas.dataset.height);

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const colors = {
    grid: role("--grid"),
    axis: role("--axis"),
    muted: role("--ink-muted"),
    series: role("--series-1"),
    compare: role("--series-2"),
    exceed: role("--status-serious"),
    surface: role("--surface"),
  };

  const plot = {
    x: PAD.left,
    y: PAD.top,
    w: cssWidth - PAD.left - PAD.right,
    h: cssHeight - PAD.top - PAD.bottom,
  };

  // --- Skalen -------------------------------------------------------------
  const finite = (a) => [...a].filter(Number.isFinite);
  const values = [...finite(dailyMax), ...finite(limit)];
  if (compare) values.push(...finite(compare.dailyMax), ...finite(compare.limit));
  if (values.length === 0) return null;

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const yMin = Math.floor((rawMin - 1) / 5) * 5;
  const yMax = Math.ceil((rawMax + 1) / 5) * 5;

  const n = dailyMax.length;
  const xOf = (day) => plot.x + (day / (n - 1)) * plot.w;
  const yOf = (t) => plot.y + plot.h - ((t - yMin) / (yMax - yMin)) * plot.h;

  // --- Raster, zurückhaltend ---------------------------------------------
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";

  for (let t = yMin; t <= yMax; t += 5) {
    const y = Math.round(yOf(t)) + 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(String(t), plot.x - 8, y);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const { label, day } of monthStarts(year)) {
    if (day >= n) continue;
    const x = Math.round(xOf(day)) + 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(x, plot.y);
    ctx.lineTo(x, plot.y + plot.h);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(label, x + plot.w / 24, plot.y + plot.h + 8);
  }

  // --- Vergleichsreihe, ganz unten ----------------------------------------
  // Vor der Überschreitungsfläche gezeichnet, nicht danach: Die Fläche ist die
  // Aussage der Basisreihe und muss zusammenhängend lesbar bleiben. Eine
  // Linie quer hindurch zerschneidet sie in Fetzen.
  if (compare) {
    ctx.strokeStyle = colors.compare;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 3]);
    ctx.globalAlpha = 0.75;
    strokeSeries(ctx, compare.limit, xOf, yOf);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeSeries(ctx, compare.dailyMax, xOf, yOf);
  }

  // --- Überschreitungsfläche ---------------------------------------------
  // Zusammenhängende Abschnitte, in denen θ_op über der Grenze liegt.
  ctx.fillStyle = colors.exceed;
  ctx.globalAlpha = 0.55;
  let run = null;
  for (let d = 0; d <= n; d++) {
    const over =
      d < n && Number.isFinite(dailyMax[d]) && Number.isFinite(limit[d]) && dailyMax[d] > limit[d];
    if (over && run === null) run = d;
    if (!over && run !== null) {
      ctx.beginPath();
      ctx.moveTo(xOf(run), yOf(limit[run]));
      for (let k = run; k < d; k++) ctx.lineTo(xOf(k), yOf(dailyMax[k]));
      for (let k = d - 1; k >= run; k--) ctx.lineTo(xOf(k), yOf(limit[k]));
      ctx.closePath();
      ctx.fill();
      run = null;
    }
  }
  ctx.globalAlpha = 1;

  // --- Komfortgrenze als gestrichelte Referenz ----------------------------
  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  strokeSeries(ctx, limit, xOf, yOf);
  ctx.setLineDash([]);

  // --- Raumtemperatur -----------------------------------------------------
  ctx.strokeStyle = colors.series;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  strokeSeries(ctx, dailyMax, xOf, yOf);

  // --- Achsen -------------------------------------------------------------
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, Math.round(plot.y + plot.h) + 0.5);
  ctx.lineTo(plot.x + plot.w, Math.round(plot.y + plot.h) + 0.5);
  ctx.stroke();

  // Einheit über den obersten Tick, nicht daneben — sonst kollidiert sie mit ihm.
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = colors.muted;
  ctx.fillText("°C", 0, plot.y - 4);

  return { plot, xOf, yOf, n, colors };
}

function strokeSeries(ctx, values, xOf, yOf) {
  ctx.beginPath();
  let drawing = false;
  for (let d = 0; d < values.length; d++) {
    const v = values[d];
    if (!Number.isFinite(v)) {
      drawing = false;
      continue;
    }
    if (drawing) ctx.lineTo(xOf(d), yOf(v));
    else {
      ctx.moveTo(xOf(d), yOf(v));
      drawing = true;
    }
  }
  ctx.stroke();
}

/**
 * Übertemperaturstunden je Messjahr als Säulen, der lineare Trend als Linie.
 *
 * Säulen stehen auf null: Ohne Nullpunkt übertreibt ihre Länge die
 * Unterschiede. Der Trend ist eine Referenz, keine zweite Serie, und trägt
 * deshalb sekundäre Tinte statt einer Serienfarbe; gestrichelt bleibt der
 * Komfortgrenze vorbehalten. Fehlende Jahre bleiben als Lücke sichtbar.
 */
export function drawYearChart(canvas, state) {
  const { years, values, fitted, hover } = state;
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = Number(canvas.dataset.height);
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (years.length === 0) return null;

  const colors = {
    grid: role("--grid"),
    axis: role("--axis"),
    muted: role("--ink-muted"),
    series: role("--series-1"),
    trend: role("--ink-secondary"),
  };
  const plot = { x: PAD.left, y: PAD.top, w: cssWidth - PAD.left - PAD.right, h: cssHeight - PAD.top - PAD.bottom };

  const first = years[0];
  const last = years[years.length - 1];
  const band = plot.w / (last - first + 1);
  const xOf = (year) => plot.x + (year - first + 0.5) * band;

  const top = Math.max(0, ...values, ...fitted.filter(Number.isFinite));
  const step = niceStep(top > 0 ? top / 4 : 25);
  const yMax = Math.max(step, Math.ceil(top / step) * step);
  const yOf = (v) => plot.y + plot.h - (v / yMax) * plot.h;

  // --- Raster ---
  ctx.lineWidth = 1;
  ctx.font = "11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    const y = Math.round(yOf(v)) + 0.5;
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
    ctx.fillStyle = colors.muted;
    ctx.fillText(v.toLocaleString("de-CH"), plot.x - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let year = Math.ceil(first / 5) * 5; year <= last; year += 5) {
    ctx.fillText(String(year), xOf(year), plot.y + plot.h + 8);
  }

  // --- Jahr unter dem Zeiger: ein Band, kein Rahmen um die Säule ---
  if (hover !== null && hover !== undefined) {
    ctx.fillStyle = colors.grid;
    ctx.fillRect(xOf(hover) - band / 2, plot.y, band, plot.h);
  }

  // --- Säulen: höchstens 24 px, oben 4 px gerundet, unten gerade ---
  const width = Math.max(2, Math.min(24, band - 2));
  const radius = Math.min(4, width / 2);
  ctx.fillStyle = colors.series;
  for (let i = 0; i < years.length; i++) {
    const y = yOf(values[i]);
    const height = plot.y + plot.h - y;
    if (height <= 0) continue;
    ctx.beginPath();
    ctx.roundRect(xOf(years[i]) - width / 2, y, width, height, [Math.min(radius, height), Math.min(radius, height), 0, 0]);
    ctx.fill();
  }

  // --- Trend ---
  if (fitted.length >= 2 && fitted.every(Number.isFinite)) {
    ctx.strokeStyle = colors.trend;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(xOf(years[0]), yOf(fitted[0]));
    ctx.lineTo(xOf(last), yOf(fitted[fitted.length - 1]));
    ctx.stroke();
  }

  // --- Grundlinie und Einheit ---
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.x, Math.round(plot.y + plot.h) + 0.5);
  ctx.lineTo(plot.x + plot.w, Math.round(plot.y + plot.h) + 0.5);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillStyle = colors.muted;
  ctx.fillText("h", 0, plot.y - 4);

  return { plot, xOf, yOf, band, first, last };
}

/** Rasterschritt 1, 2, 2.5 oder 5 mal einer Zehnerpotenz. */
function niceStep(raw) {
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * power >= raw) return m * power;
  return 10 * power;
}

/** Fadenkreuz und Marker für den Tag unter dem Zeiger. */
export function drawCrosshair(canvas, geometry, state, day) {
  const ctx = canvas.getContext("2d");
  const { xOf, yOf, plot, colors } = geometry;
  const { dailyMax, limit, compare } = state;

  const x = Math.round(xOf(day)) + 0.5;
  ctx.save();
  ctx.strokeStyle = colors.axis;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, plot.y);
  ctx.lineTo(x, plot.y + plot.h);
  ctx.stroke();

  const marks = [[limit, colors.muted], [dailyMax, colors.series]];
  if (compare) marks.unshift([compare.dailyMax, colors.compare]);

  for (const [values, color] of marks) {
    const v = values[day];
    if (!Number.isFinite(v)) continue;
    // 2px Ring in Oberflächenfarbe, damit der Marker sich vom Verlauf löst
    ctx.beginPath();
    ctx.arc(xOf(day), yOf(v), 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.surface;
    ctx.stroke();
  }
  ctx.restore();
}
