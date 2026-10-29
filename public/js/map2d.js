const WIND_RAMP = [
  [0, "#6271b7"], [1, "#39619f"], [3, "#4a94a9"], [5, "#4d8d7b"], [7, "#53a553"], [9, "#359f35"],
  [11, "#a79d51"], [13, "#9f7f3a"], [15, "#a16c5c"], [17, "#813a4e"], [19, "#af5088"], [21, "#754a93"],
  [24, "#6d61a3"], [27, "#44698d"], [29, "#5c9098"], [36, "#7d44a5"], [46, "#e7d7d7"], [51, "#dbd487"],
  [77, "#cdca70"], [104, "#808080"],
];
const PRECIP_RAMP = [
  [0, "rgba(0,0,0,0)"], [0.4, "rgba(135,206,250,0.2)"], [0.5, "rgba(0,140,255,0.3)"], [1, "rgba(0,200,160,0.5)"],
  [2.5, "rgba(0,180,60,0.6)"], [7.5, "rgba(255,220,0,0.78)"], [15, "rgba(255,140,0,0.86)"],
  [30, "rgba(220,38,127,0.93)"], [40, "rgba(128,0,200,0.98)"],
];
const CLOUD_RAMP = [
  [0, "rgba(146,130,70,0)"], [10, "rgba(132,119,70,0.05)"], [50, "rgba(116,116,116,0.15)"],
  [95, "rgba(171,180,179,0.65)"], [98, "rgba(198,201,201,0.85)"], [100, "rgba(213,213,205,0.9)"],
];
const TEMP_RAMP = [
  [-40, "rgb(130,87,219)"], [-30, "rgb(32,140,236)"], [-20, "rgb(32,196,232)"], [-10, "rgb(35,221,221)"],
  [0, "rgb(194,255,40)"], [10, "rgb(255,240,40)"], [20, "rgb(255,194,40)"], [30, "rgb(252,128,20)"],
];
const PRESSURE_RAMP = [
  [940, "rgb(0,115,255)"], [960, "rgb(0,170,255)"], [980, "rgb(75,208,214)"], [1000, "rgb(141,231,199)"],
  [1010, "rgb(176,247,32)"], [1020, "rgb(240,184,0)"], [1040, "rgb(251,85,21)"], [1060, "rgb(243,54,59)"],
  [1080, "rgb(198,0,0)"],
];

const RADAR_RAMP = [
  [5, "#92887164"], [10, "#cec08796"], [15, "#88ddee"], [20, "#00a3e0"], [25, "#0077aa"], [30, "#005588"],
  [35, "#ffee00"], [40, "#ffaa00"], [45, "#ff4400"], [50, "#c10000"], [55, "#ffaaff"], [60, "#ff77ff"], [65, "#ffffff"],
];

export const LAYERS = [
  { id: "wind", label: "Салхи", kind: "field", unit: "м/с", ramp: WIND_RAMP, legendMax: 36 },
  { id: "precipitation", label: "Хур тунадас", kind: "field", unit: "мм/ц", ramp: PRECIP_RAMP },
  { id: "radar", label: "Радар · RainViewer", kind: "radar", unit: "dBZ", ramp: RADAR_RAMP },
  { id: "clouds", label: "Үүл", kind: "field", unit: "%", ramp: CLOUD_RAMP },
  { id: "temp_new", label: "Температур", kind: "tile", unit: "°C", ramp: TEMP_RAMP },
  { id: "pressure_new", label: "Даралт", kind: "tile", unit: "гПа", ramp: PRESSURE_RAMP },
];

export function legendFor(id) {
  const layer = LAYERS.find((item) => item.id === id);
  if (!layer) return null;
  const stops = layer.ramp.filter(([value]) => layer.legendMax == null || value <= layer.legendMax);
  const css = `linear-gradient(90deg, ${stops
    .map(([, color], index) => `${color} ${Math.round((index / (stops.length - 1)) * 100)}%`)
    .join(", ")})`;
  const count = Math.min(stops.length, 6);
  const labels = Array.from({ length: count }, (_, j) => stops[Math.round((j * (stops.length - 1)) / (count - 1))][0]);
  return { css, labels, unit: layer.unit };
}

function bilinear(arr, n, gx, gy) {
  const x0 = Math.max(0, Math.min(n - 1, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(n - 1, Math.floor(gy)));
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  return (
    arr[y0 * n + x0] * (1 - tx) * (1 - ty) +
    arr[y0 * n + x1] * tx * (1 - ty) +
    arr[y1 * n + x0] * (1 - tx) * ty +
    arr[y1 * n + x1] * tx * ty
  );
}

export function windSpeeds(field) {
  return field.u.map((u, i) => Math.hypot(u, field.v[i]));
}

export function sampleField(arr, n, gx, gy) {
  return bilinear(arr, n, gx, gy);
}
