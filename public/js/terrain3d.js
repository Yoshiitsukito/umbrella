import { LAYERS, sampleField, windSpeeds } from "./map2d.js";
import { createPrecipLayer, isSnowy, rainFraction, snowFraction } from "./precip3d.js";

const OSM_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OVERTURE_HEIGHT = [
  "case",
  ["has", "height"],
  ["to-number", ["get", "height"]],
  ["has", "num_floors"],
  ["*", ["to-number", ["get", "num_floors"]], 3.2],
  5,
];
const WEATHER_OPACITY = { temp_new: 0.75, pressure_new: 0.7 };
const BUILDING_ZOOM = 13;
const GFS_BUCKET_MS = 10 * 60 * 1000;
const GFS_MODES = { precipitation: "both", clouds: "clouds", wind: "both" };
const GFS_PRECIP_LEGEND = {
  css: "linear-gradient(90deg, rgb(120,195,255) 0%, rgb(70,150,255) 14%, rgb(40,100,245) 28%, rgb(95,60,230) 42%, rgb(175,50,220) 57%, rgb(240,50,120) 71%, rgb(255,95,40) 85%, rgb(255,215,60) 100%)",
  labels: [0.1, 1.5, 4, 8, 15, 30, 60],
  unit: "мм/ц",
};
const RADAR_STEP_MS = 600;
const RADAR_HOLD_MS = 2000;
const RADAR_REFRESH_MS = 5 * 60 * 1000;
const RADAR_OPACITY = 0.85;
const RADAR_COVERAGE_OPACITY = 0.35;
const RADAR_ATTRIBUTION = 'Радар © <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';
const GFS_CLOUD_LEGEND = {
  css: "linear-gradient(90deg, rgba(238,242,247,0) 0%, rgba(238,242,247,0.35) 40%, rgba(238,242,247,0.8) 100%)",
  labels: [0, 25, 50, 75, 100],
  unit: "%",
};

function tipIcon(info) {
  if (info.precipMmH >= 0.1) return info.snow ? "❄" : "☂";
  if (info.cloud >= 80) return "☁";
  return info.isDay ? "☀" : "☾";
}
const weatherFieldCache = new Map();
const TERRAIN_TILES = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png";
const GOOGLE_FIELDS = [
  "displayName",
  "formattedAddress",
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "nationalPhoneNumber",
  "websiteURI",
  "primaryTypeDisplayName",
  "editorialSummary",
  "googleMapsURI",
  "location",
  "types",
];

let googlePromise = null;
let mapLibrePromise = null;

function loadGoogle(key) {
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const callback = `holoGoogleReady${Date.now()}`;
    window[callback] = () => resolve(window.google.maps);
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&language=mn&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      googlePromise = null;
      reject(new Error("Google Maps скрипт ачаалагдсангүй"));
    };
    document.head.append(script);
  });
  return googlePromise;
}

function loadMapLibre() {
  if (mapLibrePromise) return mapLibrePromise;
  mapLibrePromise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/vendor/maplibre-gl.css";
    document.head.append(link);
    const script = document.createElement("script");
    script.src = "/vendor/maplibre-gl.js";
    script.onload = () => resolve(window.maplibregl);
    script.onerror = () => {
      mapLibrePromise = null;
      reject(new Error("MapLibre ачаалагдсангүй"));
    };
    document.head.append(script);
  });
  return mapLibrePromise;
}

function fromGoogle(place) {
  return {
    name: place.displayName || "Нэргүй газар",
    type: place.primaryTypeDisplayName || place.types?.[0] || "",
    address: place.formattedAddress || "",
    phone: place.nationalPhoneNumber || null,
    website: place.websiteURI || null,
    hours: place.regularOpeningHours?.weekdayDescriptions || [],
    rating: place.rating ?? null,
    ratings: place.userRatingCount ?? null,
    summary: place.editorialSummary || null,
    lat: place.location?.lat(),
    lng: place.location?.lng(),
    link: place.googleMapsURI || null,
    source: "Google Maps",
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Хүсэлт амжилтгүй");
  return body;
}

function lng2tile(lng, z) {
  return ((lng + 180) / 360) * 2 ** z;
}

function lat2tile(lat, z) {
  const rad = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

function tile2lng(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tile2lat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return Math.max(-85.05, Math.min(85.05, (180 / Math.PI) * Math.atan(Math.sinh(n))));
}

function attachWeather(map, onWeather, initialPrecip, { flat = false } = {}) {
  let layerId = "none";
  let precipMode = initialPrecip;
  let field = null;
  let fieldKey = "";
  let retryAt = 0;
  let token = 0;
  let particles = [];
  let moving = false;
  let running = true;
  let dpr = 1;
  const overlay = document.createElement("canvas");
  overlay.className = "wx-particles";
  map.getContainer().append(overlay);
  const octx = overlay.getContext("2d");
  const gloom = document.createElement("div");
  gloom.className = "wx-gloom";
  map.getContainer().append(gloom);
  const precip = createPrecipLayer(map, { minZoom: BUILDING_ZOOM });
  map.addLayer(precip.layer);
  let fieldSampler = null;

  const layer = () => LAYERS.find((item) => item.id === layerId);
  const beforeId = () => map.getStyle().layers.find((item) => item.type === "symbol")?.id;

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    for (const p of particles) p.sx = null;
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const box = map.getContainer();
    overlay.width = Math.max(1, Math.floor(box.clientWidth * dpr));
    overlay.height = Math.max(1, Math.floor(box.clientHeight * dpr));
    clearOverlay();
  }

  function dropLayer(id) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }

  function removeLayers() {
    for (const id of ["wx-raster", "wx-gfs"]) dropLayer(id);
    radarJob += 1;
    stopRadar();
  }

  const zoomFade = (opacity) =>
    flat ? opacity : ["interpolate", ["linear"], ["zoom"], BUILDING_ZOOM - 0.5, opacity, BUILDING_ZOOM, 0];
  let radar = null;
  let radarJob = 0;

  function stopRadar() {
    if (!radar) return;
    clearTimeout(radar.timer);
    for (const id of radar.ids) dropLayer(id);
    dropLayer("wx-radar-cov");
    radar = null;
  }

  function radarClock(ms) {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function showRadarFrame(index) {
    if (!radar) return;
    if (radar.index !== index) map.setPaintProperty(radar.ids[radar.index], "raster-opacity", 0);
    map.setPaintProperty(radar.ids[index], "raster-opacity", zoomFade(RADAR_OPACITY));
    radar.index = index;
    const ms = radar.frames[index].time * 1000;
    onWeather({
      state: "ready",
      layer: layerId,
      clock: radarClock(ms),
      agoMin: Math.max(0, Math.round((Date.now() - ms) / 60000)),
      frame: index + 1,
      frames: radar.frames.length,
      warning: radar.warning,
    });
  }

  function radarStep() {
    if (!radar) return;
    const next = (radar.index + 1) % radar.ids.length;
    showRadarFrame(next);
    radar.timer = setTimeout(radarStep, next === radar.ids.length - 1 ? RADAR_HOLD_MS : RADAR_STEP_MS);
  }

  async function showRadar({ quiet = false } = {}) {
    const mine = ++radarJob;
    if (!quiet) onWeather({ state: "loading", layer: layerId });
    let data;
    try {
      data = await fetchJson("/api/wx/radar/frames");
    } catch (error) {
      if (mine === radarJob && !quiet) onWeather({ state: "error", layer: layerId, message: error.message });
      return;
    }
    if (mine !== radarJob || layerId !== "radar" || !data.frames?.length) return;
    if (radar && radar.latest === data.frames.at(-1).time) return;
    stopRadar();
    const before = map.getLayer("night-0") ? "night-0" : beforeId();
    const source = (tiles, extra = {}) => ({ type: "raster", tiles: [tiles], tileSize: data.tileSize, maxzoom: data.maxZoom, ...extra });
    map.addSource("wx-radar-cov", source(`${location.origin}/api/tiles/radar/coverage/{z}/{x}/{y}`, { attribution: RADAR_ATTRIBUTION }));
    map.addLayer({ id: "wx-radar-cov", type: "raster", source: "wx-radar-cov", paint: { "raster-opacity": zoomFade(RADAR_COVERAGE_OPACITY) } }, before);
    const ids = data.frames.map((frame) => {
      const id = `wx-radar-${frame.time}`;
      map.addSource(id, source(`${location.origin}/api/tiles/radar/${frame.time}/{z}/{x}/{y}`));
      map.addLayer(
        { id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-resampling": "linear" } },
        before,
      );
      return id;
    });
    const last = ids.length - 1;
    radar = { frames: data.frames, ids, index: last, latest: data.frames[last].time, timer: 0, warning: "" };
    showRadarFrame(last);
    radar.timer = setTimeout(radarStep, RADAR_HOLD_MS);
  }

  const radarTimer = setInterval(() => {
    if (layerId === "radar") showRadar({ quiet: true });
  }, RADAR_REFRESH_MS);

  const gfsBucket = () => Math.floor(Date.now() / GFS_BUCKET_MS);
  const gfsTiles = (mode) => [`${location.origin}/api/wx/tiles/${mode}/{z}/{x}/{y}.png?t=${gfsBucket()}`];
  let gfsMode = null;

  function showGfs(mode) {
    gfsMode = mode;
    map.addSource("wx-gfs", { type: "raster", tiles: gfsTiles(mode), tileSize: 256, maxzoom: 8, attribution: "Цаг агаар © NOAA GFS" });
    map.addLayer(
      {
        id: "wx-gfs",
        type: "raster",
        source: "wx-gfs",
        paint: {
          "raster-fade-duration": 300,
          "raster-resampling": "linear",
          "raster-opacity": flat ? 1 : ["interpolate", ["linear"], ["zoom"], BUILDING_ZOOM - 0.5, 1, BUILDING_ZOOM, 0],
        },
      },
      map.getLayer("night-0") ? "night-0" : beforeId(),
    );
    onWeather({
      state: "ready",
      layer: layerId,
      time: new Date(gfsBucket() * GFS_BUCKET_MS).toISOString().slice(0, 16),
      legend: mode === "clouds" ? GFS_CLOUD_LEGEND : GFS_PRECIP_LEGEND,
    });
  }

  const gfsTimer = setInterval(() => {
    if (gfsMode) map.getSource("wx-gfs")?.setTiles(gfsTiles(gfsMode));
  }, GFS_BUCKET_MS);

  const tip = document.createElement("div");
  tip.className = "wx-tip";
  tip.hidden = true;
  map.getContainer().append(tip);
  const tipCache = new Map();
  let tipTimer = 0;
  let tipToken = 0;

  async function showTip(point, lngLat) {
    const key = `${lngLat.lat.toFixed(1)},${lngLat.lng.toFixed(1)}`;
    const mine = ++tipToken;
    let info = tipCache.get(key);
    if (!info) {
      try {
        info = await fetchJson(`/api/wx/point?lat=${lngLat.lat.toFixed(3)}&lng=${lngLat.lng.toFixed(3)}`);
      } catch {
        return;
      }
      tipCache.set(key, info);
      if (tipCache.size > 300) tipCache.delete(tipCache.keys().next().value);
    }
    if (mine !== tipToken || layerId === "none") return;
    const precip = info.precipMmH >= 0.1 ? ` · ${info.precipMmH.toFixed(1)} мм/ц` : "";
    tip.innerHTML = `<b>${tipIcon(info)} ${info.condition}</b><span>${Math.round(info.tempC)}° · ${info.windKmh} км/ц <i style="transform:rotate(${info.windDirDeg + 180}deg)">↑</i> ${info.windFrom}${precip}</span>`;
    tip.style.left = `${point.x}px`;
    tip.style.top = `${point.y}px`;
    tip.hidden = false;
  }

  map.on("mousemove", (event) => {
    tip.hidden = true;
    clearTimeout(tipTimer);
    if (layerId === "none" || moving) return;
    tipTimer = setTimeout(() => showTip(event.point, event.lngLat), 220);
  });
  map.getCanvas().addEventListener("mouseleave", () => {
    clearTimeout(tipTimer);
    tipToken += 1;
    tip.hidden = true;
  });

  function corners(f) {
    const west = tile2lng(f.x - f.R, f.z);
    const east = tile2lng(f.x + f.R + 1, f.z);
    const north = tile2lat(f.y - f.R, f.z);
    const south = tile2lat(f.y + f.R + 1, f.z);
    return { west, east, north, south };
  }

  function showTiles() {
    map.addSource("wx-raster", {
      type: "raster",
      tiles: [`${location.origin}/api/tiles/owm/${layerId}/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 12,
      attribution: "Цаг агаар © OpenWeatherMap",
    });
    map.addLayer(
      { id: "wx-raster", type: "raster", source: "wx-raster", paint: { "raster-opacity": WEATHER_OPACITY[layerId] } },
      beforeId(),
    );
    onWeather({ state: "ready", layer: layerId });
  }

  function fieldCovers(fz, center) {
    if (!field || field.z > fz || field.z < fz - 3) return false;
    const x = lng2tile(center.lng, field.z);
    const y = lat2tile(center.lat, field.z);
    return Math.abs(x - (field.x + 0.5)) < 2 && Math.abs(y - (field.y + 0.5)) < 2;
  }

  let fieldTimer = 0;
  function scheduleField() {
    clearTimeout(fieldTimer);
    fieldTimer = setTimeout(ensureField, 700);
  }

  function needsField() {
    return layer()?.kind === "field" || precipMode !== "off";
  }

  function gridAt(lng, lat) {
    if (!field) return null;
    const span = field.R * 2 + 1;
    const gx = ((lng2tile(lng, field.z) - (field.x - field.R)) / span) * (field.N - 1);
    const gy = ((lat2tile(lat, field.z) - (field.y - field.R)) / span) * (field.N - 1);
    if (gx < 0 || gy < 0 || gx > field.N - 1 || gy > field.N - 1) return null;
    return { gx, gy };
  }

  function precipAt(lng, lat) {
    const g = gridAt(lng, lat);
    if (!g) return null;
    const n = field.N;
    return {
      mm: Math.max(0, sampleField(field.precip, n, g.gx, g.gy)),
      snow: field.snow ? sampleField(field.snow, n, g.gx, g.gy) : 0,
      temp: field.temp ? sampleField(field.temp, n, g.gx, g.gy) : 5,
    };
  }

  function cellAt(f, k) {
    const span = f.R * 2 + 1;
    const i = k % f.N;
    const j = Math.floor(k / f.N);
    return {
      lng: tile2lng(f.x - f.R + (i / (f.N - 1)) * span, f.z),
      lat: tile2lat(f.y - f.R + (j / (f.N - 1)) * span, f.z),
      mm: Math.max(0, f.precip[k]),
      snow: f.snow?.[k] || 0,
      temp: f.temp?.[k] ?? 5,
    };
  }

  function viewSummary() {
    const bounds = map.getBounds();
    let cells = 0;
    let wet = 0;
    let rainMm = 0;
    let snowMm = 0;
    const add = (cell) => {
      cells += 1;
      if (cell.mm < 0.1) return;
      wet += 1;
      if (isSnowy(cell)) snowMm = Math.max(snowMm, cell.mm);
      else rainMm = Math.max(rainMm, cell.mm);
    };
    for (let k = 0; k < field.N * field.N; k += 1) {
      const cell = cellAt(field, k);
      if (bounds.contains([cell.lng, cell.lat])) add(cell);
    }
    if (!cells) {
      const center = map.getCenter();
      const here = precipAt(center.lng, center.lat);
      if (here) add(here);
    }
    return { rainMm, snowMm, coverage: cells ? wet / cells : 0 };
  }

  function updatePrecip() {
    let rain = false;
    let snow = false;
    let sampler = null;
    let rainMm = 0;
    let snowMm = 0;
    let coverage = 1;
    if (precipMode === "auto" && field) {
      ({ rainMm, snowMm, coverage } = viewSummary());
      rain = rainMm >= 0.1;
      snow = snowMm >= 0.1;
      sampler = fieldSampler;
    }
    const center = map.getCenter();
    const wind = field ? windAt(center.lng, center.lat) : null;
    precip.setState({ rain, snow, sampler, wind: wind || { u: 0, v: 0 } });
    const rainStrength = rain ? rainFraction(rainMm) : 0;
    const snowStrength = snow ? snowFraction(snowMm) : 0;
    const strength = Math.max(rainStrength, snowStrength) * Math.min(1, 0.35 + coverage * 1.3);
    const kind = !rain && !snow ? "none" : snowStrength > rainStrength ? "snow" : "rain";
    gloom.className = `wx-gloom ${kind}`;
    gloom.style.opacity = String(kind === "none" || map.getZoom() < BUILDING_ZOOM ? 0 : 0.3 + strength * 0.65);
  }

  function ensureField() {
    if (!running || !needsField() || Date.now() < retryAt) return;
    const fz = Math.max(2, Math.min(14, Math.floor(map.getZoom())));
    const center = map.getCenter();
    if (fieldCovers(fz, center)) return;
    const cx = Math.floor(lng2tile(center.lng, fz));
    const n = 2 ** fz;
    const cy = Math.max(0, Math.min(n - 1, Math.floor(lat2tile(center.lat, fz))));
    const wx = ((cx % n) + n) % n;
    const key = `${fz}/${wx}/${cy}`;
    if (key === fieldKey) return;
    fieldKey = key;
    const mine = ++token;
    const apply = (data) => {
      if (mine !== token) return;
      field = { ...data, x: data.x + (cx - wx), speed: windSpeeds(data) };
      fieldSampler = (lng, lat) => precipAt(lng, lat);
      particles = [];
      clearOverlay();
      updatePrecip();
    };
    const cached = weatherFieldCache.get(key);
    if (cached) {
      apply(cached);
      return;
    }
    fetch(`/api/field?z=${fz}&x=${wx}&y=${cy}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Цаг агаарын талбар ачаалагдсангүй");
        weatherFieldCache.set(key, data);
        if (weatherFieldCache.size > 60) weatherFieldCache.delete(weatherFieldCache.keys().next().value);
        apply(data);
      })
      .catch((error) => {
        if (mine !== token) return;
        fieldKey = "";
        retryAt = Date.now() + 20000;
        if (layerId === "wind") onWeather({ state: "error", layer: layerId, message: error.message });
      });
  }

  function windAt(lng, lat) {
    const span = field.R * 2 + 1;
    const gx = ((lng2tile(lng, field.z) - (field.x - field.R)) / span) * (field.N - 1);
    const gy = ((lat2tile(lat, field.z) - (field.y - field.R)) / span) * (field.N - 1);
    if (gx < 0 || gy < 0 || gx > field.N - 1 || gy > field.N - 1) return null;
    return { u: sampleField(field.u, field.N, gx, gy), v: sampleField(field.v, field.N, gx, gy) };
  }

  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    if (layerId !== "wind" || !field || moving) return;
    const w = overlay.width;
    const h = overlay.height;
    octx.globalCompositeOperation = "destination-in";
    octx.fillStyle = "rgba(0,0,0,0.9)";
    octx.fillRect(0, 0, w, h);
    octx.globalCompositeOperation = "source-over";
    const view = map.getBounds();
    const box = corners(field);
    const area = {
      west: Math.max(view.getWest(), box.west),
      east: Math.min(view.getEast(), box.east),
      north: Math.min(view.getNorth(), box.north),
      south: Math.max(view.getSouth(), box.south),
    };
    if (area.east <= area.west || area.north <= area.south) return;
    const spawn = () => ({
      lng: area.west + Math.random() * (area.east - area.west),
      lat: area.south + Math.random() * (area.north - area.south),
      age: 0,
      max: 40 + Math.random() * 60,
      sx: null,
      sy: null,
    });
    const target = Math.min(1400, Math.round((w * h) / (dpr * dpr * 650)));
    while (particles.length < target) particles.push(spawn());
    if (particles.length > target) particles.length = target;
    const step = (0.25 * 360) / (512 * 2 ** map.getZoom());
    octx.beginPath();
    octx.strokeStyle = "rgba(255,255,255,0.85)";
    octx.lineWidth = 1.2 * dpr;
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      const wind = windAt(p.lng, p.lat);
      const outside = p.lng < area.west || p.lng > area.east || p.lat < area.south || p.lat > area.north;
      if (!wind || outside || p.age > p.max) {
        particles[i] = spawn();
        continue;
      }
      p.lng += wind.u * step;
      p.lat += wind.v * step * Math.cos((p.lat * Math.PI) / 180);
      p.age += 1;
      const point = map.project([p.lng, p.lat]);
      const sx = point.x * dpr;
      const sy = point.y * dpr;
      if (p.sx != null) {
        octx.moveTo(p.sx, p.sy);
        octx.lineTo(sx, sy);
      }
      p.sx = sx;
      p.sy = sy;
    }
    octx.stroke();
  }

  map.on("resize", resize);
  map.on("movestart", () => {
    moving = true;
    clearOverlay();
  });
  map.on("moveend", () => {
    moving = false;
    clearOverlay();
    scheduleField();
    updatePrecip();
  });
  map.on("error", (event) => {
    if (event?.sourceId === "wx-raster") onWeather({ state: "error", layer: layerId, message: "OpenWeatherMap тайл ачаалагдсангүй" });
    if (event?.sourceId === "wx-gfs") onWeather({ state: "error", layer: layerId, message: "NOAA GFS тайл ачаалагдсангүй" });
    if (radar && event?.sourceId?.startsWith("wx-radar")) radar.warning = "Зарим радарын тайл ачаалагдсангүй";
  });
  resize();
  requestAnimationFrame(frame);

  return {
    setLayer(next) {
      layerId = LAYERS.some((item) => item.id === next) ? next : "none";
      token += 1;
      fieldKey = "";
      retryAt = 0;
      particles = [];
      gfsMode = null;
      tip.hidden = true;
      clearOverlay();
      removeLayers();
      if (layerId === "none") {
        onWeather({ state: "off" });
      } else if (layer().kind === "tile") {
        showTiles();
      } else if (layer().kind === "radar") {
        showRadar();
      } else {
        showGfs(GFS_MODES[layerId]);
      }
      ensureField();
    },
    setPrecipMode(mode) {
      precipMode = mode;
      retryAt = 0;
      updatePrecip();
      ensureField();
    },
    start() {
      updatePrecip();
    },
    destroy() {
      running = false;
      clearTimeout(fieldTimer);
      clearTimeout(tipTimer);
      clearInterval(gfsTimer);
      clearInterval(radarTimer);
      stopRadar();
      overlay.remove();
      gloom.remove();
      tip.remove();
    },
  };
}

async function createGoogle(container, { center, key, onPlace, onFail }) {
  window.gm_authFailure = () => onFail(new Error("Google Maps түлхүүр зөвшөөрөгдсөнгүй (API идэвхжүүлэлт, төлбөр, referrer хязгаарлалтыг шалгана уу)"));
  const maps = await loadGoogle(key);
  const { Map3DElement, Marker3DElement } = await maps.importLibrary("maps3d");
  const { Place } = await maps.importLibrary("places");
  const map = new Map3DElement({
    center: { lat: center.lat, lng: center.lng, altitude: 0 },
    range: 2500,
    tilt: 65,
    heading: -20,
    mode: "HYBRID",
  });
  map.style.width = "100%";
  map.style.height = "100%";
  map.addEventListener("gmp-error", () => onFail(new Error("Google 3D газрын зураг эхэлсэнгүй")));
  container.append(map);
  let marker = null;

  const mark = (lat, lng) => {
    marker?.remove();
    marker = new Marker3DElement({ position: { lat, lng } });
    map.append(marker);
  };
  const flyTo = (lat, lng, range = 900) => {
    map.flyCameraTo({
      endCamera: { center: { lat, lng, altitude: 0 }, range, tilt: 65, heading: map.heading || 0 },
      durationMillis: 2500,
    });
  };

  map.addEventListener("gmp-click", async (event) => {
    event.preventDefault();
    const position = event.position;
    try {
      if (event.placeId) {
        onPlace({ loading: true });
        const place = await event.fetchPlace();
        await place.fetchFields({ fields: GOOGLE_FIELDS });
        onPlace(fromGoogle(place));
      } else if (position) {
        onPlace({ loading: true });
        onPlace(await fetchJson(`/api/place?lat=${position.lat}&lng=${position.lng}`));
      }
    } catch (error) {
      onPlace({ error: error.message });
    }
  });

  return {
    provider: "google",
    async search(query) {
      const { places } = await Place.searchByText({
        textQuery: query,
        fields: GOOGLE_FIELDS,
        locationBias: { lat: center.lat, lng: center.lng },
        maxResultCount: 6,
        language: "mn",
      });
      const list = (places || []).map(fromGoogle);
      if (list[0]) {
        mark(list[0].lat, list[0].lng);
        flyTo(list[0].lat, list[0].lng);
      }
      return list;
    },
    show(place) {
      mark(place.lat, place.lng);
      flyTo(place.lat, place.lng);
    },
    home() {
      flyTo(center.lat, center.lng, 2500);
    },
    setWeatherLayer() {
      return false;
    },
    setPrecipMode() {
      return false;
    },
    setTraffic() {
      return false;
    },
    destroy() {
      map.remove();
    },
  };
}

const SATELLITE_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const NIGHT_BANDS = [
  { elevation: 0, opacity: 0.2 },
  { elevation: -6, opacity: 0.15 },
  { elevation: -12, opacity: 0.14 },
];

function styleAsEarth(map, layers) {
  map.addSource("satellite", {
    type: "raster",
    tiles: [SATELLITE_TILES],
    tileSize: 256,
    maxzoom: 16,
    attribution: "Sentinel-2 cloudless 2024 © EOX IT Services GmbH (Copernicus Sentinel data)",
  });
  map.addLayer({ id: "satellite", type: "raster", source: "satellite", paint: { "raster-fade-duration": 200 } }, layers[0]?.id);
  for (const layer of layers) {
    const group = layer["source-layer"];
    if (layer.type === "background" || (layer.type === "fill" && group !== "building") || group === "waterway" || group === "aeroway") {
      map.setLayoutProperty(layer.id, "visibility", "none");
    } else if (layer.type === "line" && group === "transportation") {
      map.setLayerZoomRange(layer.id, 12, 24);
      map.setPaintProperty(layer.id, "line-opacity", 0.55);
    } else if (layer.type === "line" && group === "boundary") {
      map.setPaintProperty(layer.id, "line-color", "rgba(255,255,255,0.55)");
    } else if (layer.type === "symbol") {
      map.setPaintProperty(layer.id, "text-color", "#ffffff");
      map.setPaintProperty(layer.id, "text-halo-color", "rgba(0,0,0,0.75)");
      map.setPaintProperty(layer.id, "text-halo-width", 1.4);
    }
  }
}

function sunPosition(ms) {
  const date = new Date(ms);
  const dayOfYear = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);
  const decl =
    0.006918 - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma) - 0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const eqTime =
    229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma) - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  return { decl, lng: -15 * (hours - 12) - eqTime / 4 };
}

export function nightPolygon(ms, elevationDeg = 0) {
  const sun = sunPosition(ms);
  const rad = Math.PI / 180;
  const sinH = Math.sin(elevationDeg * rad);
  const elevationAbove = (lat, lng) =>
    Math.sin(lat * rad) * Math.sin(sun.decl) + Math.cos(lat * rad) * Math.cos(sun.decl) * Math.cos((lng - sun.lng) * rad) >= sinH;
  const pole = sun.decl < 0 ? 85 : -85;
  const dir = pole > 0 ? -1 : 1;
  const ring = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    let lat = pole;
    while (Math.abs(lat) <= 85 && !elevationAbove(lat, lng)) lat += dir * 0.5;
    ring.push([lng, Math.max(-85, Math.min(85, lat))]);
  }
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
}

function addNight(map, beforeId) {
  NIGHT_BANDS.forEach((band, index) => {
    map.addSource(`night-${index}`, { type: "geojson", data: nightPolygon(Date.now(), band.elevation) });
    map.addLayer({ id: `night-${index}`, type: "fill", source: `night-${index}`, paint: { "fill-color": "#000814", "fill-opacity": band.opacity, "fill-antialias": false } }, beforeId);
  });
  const timer = setInterval(() => {
    NIGHT_BANDS.forEach((band, index) => map.getSource(`night-${index}`)?.setData(nightPolygon(Date.now(), band.elevation)));
  }, 5 * 60 * 1000);
  return () => clearInterval(timer);
}

const TRAFFIC_REFRESH_MS = 2 * 60 * 1000;
const trafficTiles = () => [`${location.origin}/api/tiles/traffic/{z}/{x}/{y}?t=${Math.floor(Date.now() / TRAFFIC_REFRESH_MS)}`];

async function createOsm(
  container,
  {
    center,
    onPlace,
    onStatus,
    onWeather = () => {},
    onTraffic = () => {},
    weatherLayer = "none",
    precipMode = "auto",
    traffic = false,
    flat = false,
  },
) {
  const maplibregl = await loadMapLibre();
  const map = new maplibregl.Map({
    container,
    style: OSM_STYLE,
    center: flat ? [center.lng, 25] : [center.lng, center.lat],
    zoom: flat ? Math.max(0, Math.log2(container.clientWidth / 512)) : 14.6,
    pitch: flat ? 0 : 66,
    bearing: flat ? 0 : -25,
    maxPitch: flat ? 0 : 85,
    dragRotate: !flat,
    pitchWithRotate: !flat,
    touchPitch: !flat,
    attributionControl: { compact: true },
  });
  if (flat) map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: !flat, showCompass: !flat }), "top-right");
  new maplibregl.Marker({ color: "#e60012" }).setLngLat([center.lng, center.lat]).addTo(map);
  let marker = null;
  let weather = null;
  let pendingLayer = weatherLayer;
  let pendingPrecip = precipMode;
  let trafficOn = traffic;
  let trafficState = "";
  let trafficTimer = 0;
  let stopNight = () => {};

  const showTraffic = () => {
    if (!map.getLayer("traffic")) return;
    map.setLayoutProperty("traffic", "visibility", trafficOn ? "visible" : "none");
    clearInterval(trafficTimer);
    trafficState = "";
    onTraffic({ state: trafficOn ? "loading" : "off" });
    if (trafficOn) trafficTimer = setInterval(() => map.getSource("traffic")?.setTiles(trafficTiles()), TRAFFIC_REFRESH_MS);
  };

  map.on("zoomend", () => {
    if (!flat && map.getZoom() < 4 && map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 900 });
  });

  map.on("sourcedata", (event) => {
    if (event.sourceId !== "traffic" || !trafficOn || trafficState === "ready" || !event.tile) return;
    trafficState = "ready";
    onTraffic({ state: "ready" });
  });
  map.on("error", (event) => {
    if (event?.sourceId !== "traffic" || !trafficOn || trafficState) return;
    trafficState = "error";
    const n = 2 ** 14;
    const x = Math.floor(((center.lng + 180) / 360) * n);
    const lat = (center.lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
    onTraffic({ state: "error", url: `/api/tiles/traffic/14/${x}/${y}` });
  });

  map.on("style.load", () => {
    const layers = map.getStyle().layers;
    const firstSymbol = layers.find((layer) => layer.type === "symbol")?.id;
    if (flat) {
      map.setProjection?.({ type: "mercator" });
    } else {
      const dem = { type: "raster-dem", tiles: [TERRAIN_TILES], encoding: "terrarium", tileSize: 256, maxzoom: 15 };
      map.addSource("holo-dem", { ...dem, attribution: "Өндөр © Mapzen, AWS Terrain Tiles" });
      map.setTerrain({ source: "holo-dem", exaggeration: 1.5 });
      map.setProjection?.({ type: "globe" });
      map.setSky?.({
        "sky-color": "#0b1a33",
        "horizon-color": "#5d7fb0",
        "fog-color": "#0a0a0a",
        "sky-horizon-blend": 0.5,
        "horizon-fog-blend": 0.5,
        "fog-ground-blend": 0.6,
        "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 6, 0.6, 9, 0],
      });
    }
    styleAsEarth(map, layers);
    stopNight = addNight(map, firstSymbol);
    for (const layer of layers) {
      const field = layer.layout?.["text-field"];
      if (layer.type === "symbol" && field && JSON.stringify(field).includes("name")) {
        map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:mn"], ["get", "name"]]);
      }
    }
    const heightColor = (height) => ["interpolate", ["linear"], height, 0, "#efefef", 40, "#e3b8b8", 120, "#e60012"];
    if (map.getLayer("building-3d")) {
      map.setPaintProperty("building-3d", "fill-extrusion-color", heightColor(["coalesce", ["get", "render_height"], 0]));
      map.setPaintProperty("building-3d", "fill-extrusion-opacity", 0.92);
    }
    const osmBuildings = layers.filter((layer) => layer["source-layer"] === "building").map((layer) => layer.id);
    const showOsmBuildings = (visible) => {
      for (const id of osmBuildings) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    if (flat) {
      showOsmBuildings(false);
      addTraffic();
      return;
    }
    map.addSource("overture-buildings", {
      type: "vector",
      tiles: [`${location.origin}/api/tiles/buildings/{z}/{x}/{y}`],
      minzoom: 12,
      maxzoom: 14,
      attribution: "Барилга © Overture Maps Foundation",
    });
    map.addLayer(
      {
        id: "overture-3d",
        type: "fill-extrusion",
        source: "overture-buildings",
        "source-layer": "building",
        minzoom: BUILDING_ZOOM,
        filter: ["!=", ["get", "is_underground"], true],
        paint: {
          "fill-extrusion-color": heightColor(OVERTURE_HEIGHT),
          "fill-extrusion-height": OVERTURE_HEIGHT,
          "fill-extrusion-base": ["to-number", ["coalesce", ["get", "min_height"], 0]],
          "fill-extrusion-opacity": 0.92,
        },
      },
      osmBuildings.find((id) => map.getLayer(id)?.type === "fill-extrusion") || firstSymbol,
    );
    showOsmBuildings(false);
    let overtureErrors = 0;
    map.on("error", (event) => {
      if (event?.sourceId !== "overture-buildings" || !map.getLayer("overture-3d")) return;
      overtureErrors += 1;
      if (overtureErrors < 4) return;
      map.removeLayer("overture-3d");
      showOsmBuildings(true);
    });
    addTraffic();
  });

  function addTraffic() {
    const firstSymbol = map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
    map.addSource("traffic", {
      type: "raster",
      tiles: trafficTiles(),
      tileSize: 256,
      maxzoom: 20,
      attribution: "Түгжрэл © Google",
    });
    map.addLayer(
      { id: "traffic", type: "raster", source: "traffic", layout: { visibility: "none" }, paint: { "raster-opacity": 0.95 } },
      map.getLayer("building-3d") ? "building-3d" : firstSymbol,
    );
    showTraffic();
    onStatus({ state: "ready", provider: "osm", flat });
    weather = attachWeather(map, onWeather, pendingPrecip, { flat });
    weather.setLayer(pendingLayer);
    weather.start();
  }
  map.on("error", (event) => {
    if (event?.error?.message && !/tile|terrarium|Failed to fetch/i.test(event.error.message)) {
      onStatus({ state: "error", message: event.error.message });
    }
  });

  const namedAt = (point) =>
    map
      .queryRenderedFeatures(point)
      .find((feature) => feature.layer.type === "symbol" && (feature.properties?.name || feature.properties?.["name:mn"]));

  map.on("mousemove", (event) => {
    map.getCanvas().style.cursor = namedAt(event.point) ? "pointer" : "";
  });

  const mark = (lng, lat) => {
    marker?.remove();
    marker = new maplibregl.Marker({ color: "#ffffff" }).setLngLat([lng, lat]).addTo(map);
  };

  map.on("click", async (event) => {
    const feature = namedAt(event.point);
    const name = feature ? feature.properties["name:mn"] || feature.properties.name : "";
    const [lng, lat] = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : [event.lngLat.lng, event.lngLat.lat];
    mark(lng, lat);
    onPlace({ loading: true, name });
    try {
      const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
      if (name) params.set("name", name);
      onPlace(await fetchJson(`/api/place?${params}`));
    } catch (error) {
      onPlace(name ? { name, lat, lng, source: "OpenStreetMap", address: "", hours: [] } : { error: error.message });
    }
  });

  const flyTo = (lat, lng, zoom = 16.2) => map.flyTo({ center: [lng, lat], zoom, pitch: flat ? 0 : 66, duration: 2500 });

  return {
    provider: "osm",
    async search(query) {
      const params = new URLSearchParams({ q: query, lat: String(center.lat), lng: String(center.lng) });
      const { places } = await fetchJson(`/api/place-search?${params}`);
      if (places[0]) {
        mark(places[0].lng, places[0].lat);
        flyTo(places[0].lat, places[0].lng);
      }
      return places;
    },
    show(place) {
      mark(place.lng, place.lat);
      flyTo(place.lat, place.lng);
    },
    home() {
      flyTo(center.lat, center.lng, flat ? 6 : 14.6);
    },
    setWeatherLayer(id) {
      pendingLayer = id;
      weather?.setLayer(id);
      return true;
    },
    setPrecipMode(mode) {
      pendingPrecip = mode;
      weather?.setPrecipMode(mode);
      return true;
    },
    setTraffic(on) {
      trafficOn = Boolean(on);
      showTraffic();
      return true;
    },
    destroy() {
      clearInterval(trafficTimer);
      stopNight();
      weather?.destroy();
      map.remove();
    },
  };
}

export async function createPlaceMap(container, settings) {
  const onStatus = settings.onStatus || (() => {});
  let inner = null;
  let destroyed = false;
  let switched = false;
  let weatherLayer = settings.weatherLayer || "none";
  let precipMode = settings.precipMode || "auto";
  let traffic = Boolean(settings.traffic);
  const onTraffic = settings.onTraffic || (() => {});

  const useOsm = async (reason) => {
    inner?.destroy();
    inner = null;
    container.replaceChildren();
    if (reason) onStatus({ state: "fallback", message: reason.message });
    const created = await createOsm(container, { ...settings, onStatus, weatherLayer, precipMode, traffic });
    if (destroyed) created.destroy();
    else inner = created;
  };

  const config = settings.flat ? {} : await fetchJson("/api/maps/config").catch(() => ({}));
  if (config.googleKey) {
    const onFail = (error) => {
      if (switched || destroyed) return;
      switched = true;
      useOsm(error).catch((failure) => onStatus({ state: "error", message: failure.message }));
    };
    try {
      const google = await createGoogle(container, { ...settings, key: config.googleKey, onFail });
      if (switched || destroyed) google.destroy();
      else {
        inner = google;
        onStatus({ state: "ready", provider: "google" });
        if (traffic) onTraffic({ state: "unsupported" });
      }
    } catch (error) {
      onFail(error);
    }
  } else {
    await useOsm(null);
  }

  const current = () => {
    if (!inner) throw new Error("Газрын зураг ачаалж байна");
    return inner;
  };
  return {
    get provider() {
      return inner?.provider || null;
    },
    search: (query) => current().search(query),
    show: (place) => current().show(place),
    home: () => inner?.home(),
    setWeatherLayer(id) {
      weatherLayer = id;
      return inner ? inner.setWeatherLayer(id) : true;
    },
    setPrecipMode(mode) {
      precipMode = mode;
      return inner ? inner.setPrecipMode(mode) : true;
    },
    setTraffic(on) {
      traffic = Boolean(on);
      if (!inner) return true;
      const supported = inner.setTraffic(traffic);
      if (!supported) onTraffic({ state: traffic ? "unsupported" : "off" });
      return supported;
    },
    destroy() {
      destroyed = true;
      inner?.destroy();
      inner = null;
    },
  };
}
