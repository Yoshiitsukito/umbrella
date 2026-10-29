const EARTH = 40075016.686;
const MAX_RAIN = 4500;
const MAX_SNOW = 3500;
const MAX_SPLASH = 900;
const RAIN_STRIDE = 9;
const RAIN_FLOATS = RAIN_STRIDE * 6;
const CORNERS = [
  [0, -1],
  [0, 1],
  [1, 1],
  [0, -1],
  [1, 1],
  [1, -1],
];

const RAIN_VS = `
uniform mat4 u_matrix;
uniform float u_wref;
uniform vec2 u_viewport;
attribute vec3 a_head;
attribute vec3 a_tail;
attribute float a_end;
attribute float a_side;
attribute float a_alpha;
varying float v_alpha;
varying float v_end;
varying float v_side;
void main() {
  vec4 head = u_matrix * vec4(a_head, 1.0);
  vec4 tail = u_matrix * vec4(a_tail, 1.0);
  vec4 self = mix(head, tail, a_end);
  vec2 dir = tail.xy / max(tail.w, 0.001) - head.xy / max(head.w, 0.001);
  dir *= u_viewport;
  float len = length(dir);
  vec2 n = len > 0.0001 ? vec2(-dir.y, dir.x) / len : vec2(1.0, 0.0);
  float near = u_wref / max(self.w, 0.001);
  float width = clamp(1.1 * near, 0.7, 5.0);
  self.xy += n * a_side * width / u_viewport * self.w;
  gl_Position = self;
  v_alpha = a_alpha * clamp(near, 0.45, 1.6);
  v_end = a_end;
  v_side = a_side;
}`;

const RAIN_FS = `
precision mediump float;
uniform vec3 u_color;
varying float v_alpha;
varying float v_end;
varying float v_side;
void main() {
  float edge = 1.0 - abs(v_side);
  float body = mix(1.0, 0.0, v_end);
  float a = clamp(v_alpha * edge * body, 0.0, 1.0);
  gl_FragColor = vec4(u_color * a, a);
}`;

const SNOW_VS = `
uniform mat4 u_matrix;
uniform float u_wref;
uniform float u_dpr;
attribute vec3 a_pos;
attribute float a_size;
attribute float a_alpha;
varying float v_alpha;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  float near = u_wref / max(gl_Position.w, 0.001);
  gl_PointSize = clamp(a_size * near * u_dpr, 1.0, 34.0);
  v_alpha = a_alpha * clamp(near, 0.4, 1.3);
}`;

const SNOW_FS = `
precision mediump float;
varying float v_alpha;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.12, d) * clamp(v_alpha, 0.0, 1.0);
  gl_FragColor = vec4(vec3(0.97, 0.98, 1.0) * a, a);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

export function rainFraction(mm) {
  return mm < 0.1 ? 0 : Math.min(1, 0.15 + mm / 6);
}

export function snowFraction(mm) {
  return mm < 0.05 ? 0 : Math.min(1, 0.2 + mm / 2);
}

export function isSnowy(local) {
  return (local.snow ?? 0) > 0.02 || (local.temp ?? 5) <= 0.5;
}

export function createPrecipLayer(map, { minZoom = 0 } = {}) {
  let gl = null;
  let rainProgram = null;
  let snowProgram = null;
  let rainBuffer = null;
  let snowBuffer = null;
  const rainData = new Float32Array(MAX_RAIN * RAIN_FLOATS);
  const snowData = new Float32Array(MAX_SNOW * 6);
  const splashData = new Float32Array(MAX_SPLASH * 6);
  let drops = [];
  let flakes = [];
  let splashes = [];
  let state = { rain: false, snow: false, sampler: null, wind: { u: 0, v: 0 } };
  let frameScale = 0;
  let last = performance.now();
  let volume = null;

  function center() {
    const c = map.getCenter();
    const worldSize = map.transform.worldSize;
    const x = ((c.lng + 180) / 360) * worldSize;
    const rad = (c.lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldSize;
    const ppm = worldSize / (EARTH * Math.cos(rad));
    return { lng: c.lng, lat: c.lat, x, y, z: map.getCenterElevation() || 0, ppm, worldSize };
  }

  function cameraLocal(origin) {
    const t = map.transform;
    const cam = t.getCameraLngLat();
    let alt = t.getCameraAltitude();
    if (!Number.isFinite(alt)) alt = (Math.cos((map.getPitch() * Math.PI) / 180) * t.cameraToCenterDistance) / origin.ppm + origin.z;
    const x = ((cam.lng + 180) / 360) * origin.worldSize;
    const rad = (cam.lat * Math.PI) / 180;
    const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * origin.worldSize;
    return { east: (x - origin.x) / origin.ppm, north: -(y - origin.y) / origin.ppm, up: alt - origin.z };
  }

  function updateVolume(origin) {
    const cam = cameraLocal(origin);
    const ground = Math.hypot(cam.east, cam.north);
    const reach = Math.max(ground, cam.up, 50);
    volume = [
      {
        cx: cam.east * 0.4,
        cy: cam.north * 0.4,
        half: reach * 0.95,
        top: Math.max(30, Math.min(cam.up * 0.85, reach * 0.9)),
      },
      {
        cx: cam.east * 0.72,
        cy: cam.north * 0.72,
        half: reach * 0.28,
        top: Math.max(20, cam.up * 0.95),
      },
    ];
  }

  function outside(p) {
    const v = volume[p.vol];
    if (!Number.isFinite(p.east + p.north + p.up)) return true;
    return p.up < 0 || Math.abs(p.east - v.cx) > v.half || Math.abs(p.north - v.cy) > v.half;
  }

  function localToLngLat(origin, east, north) {
    return {
      lng: origin.lng + east / (111320 * Math.cos((origin.lat * Math.PI) / 180)),
      lat: origin.lat + north / 110540,
    };
  }

  function spawn(origin, kind, top) {
    const vol = Math.random() < 0.4 ? 1 : 0;
    const v = volume[vol];
    let east = 0;
    let north = 0;
    let fraction = 0;
    for (let attempt = 0; attempt < 8 && fraction === 0; attempt += 1) {
      east = v.cx + (Math.random() * 2 - 1) * v.half;
      north = v.cy + (Math.random() * 2 - 1) * v.half;
      const where = localToLngLat(origin, east, north);
      const local = state.sampler ? state.sampler(where.lng, where.lat) : null;
      if (!local || (kind === "snow") !== isSnowy(local)) continue;
      fraction = kind === "snow" ? snowFraction(local.mm) : rainFraction(local.mm);
    }
    const up = top ? v.top * (0.85 + Math.random() * 0.15) : Math.random() * v.top;
    const on = Math.random() < fraction;
    return {
      vol,
      east,
      north,
      up,
      on,
      phase: Math.random() * Math.PI * 2,
      size: 2 + Math.random() * 3.5,
      speed: 0.8 + Math.random() * 0.4,
      shade: 0.55 + Math.random() * 0.45,
    };
  }

  function writeDrop(o, head, tail, alpha) {
    for (let c = 0; c < 6; c += 1) {
      const [end, side] = CORNERS[c];
      const k = o + c * RAIN_STRIDE;
      rainData[k] = head[0];
      rainData[k + 1] = head[1];
      rainData[k + 2] = head[2];
      rainData[k + 3] = tail[0];
      rainData[k + 4] = tail[1];
      rainData[k + 5] = tail[2];
      rainData[k + 6] = end;
      rainData[k + 7] = side;
      rainData[k + 8] = alpha;
    }
  }

  function step(origin, dt) {
    const mpp = 1 / origin.ppm;
    if (!frameScale || Math.abs(mpp / frameScale - 1) > 0.25) {
      frameScale = mpp;
      drops = [];
      flakes = [];
      splashes = [];
    }
    updateVolume(origin);
    const wind = state.wind;
    if (!state.rain) {
      drops = [];
      splashes = [];
    }
    if (!state.snow) flakes = [];
    if (state.rain) {
      while (drops.length < MAX_RAIN) drops.push(spawn(origin, "rain", false));
      const fall = 950 * mpp;
      const length = 24 * mpp;
      const vx = wind.u * 30 * mpp;
      const vy = wind.v * 30 * mpp;
      const norm = Math.hypot(vx, vy, fall) || 1;
      for (let i = 0; i < drops.length; i += 1) {
        let d = drops[i];
        d.east += vx * dt * d.speed;
        d.north += vy * dt * d.speed;
        d.up -= fall * dt * d.speed;
        if (outside(d)) {
          if (d.up < 0 && d.on && splashes.length < MAX_SPLASH) {
            splashes.push({ east: d.east, north: d.north, age: 0, size: 3 + Math.random() * 3 });
          }
          d = spawn(origin, "rain", true);
          drops[i] = d;
        }
        const px = d.east * origin.ppm;
        const py = -d.north * origin.ppm;
        const len = length * d.speed;
        writeDrop(
          i * RAIN_FLOATS,
          [px, py, d.up],
          [px - (vx / norm) * len * origin.ppm, py + (vy / norm) * len * origin.ppm, d.up + (fall / norm) * len],
          d.on ? 0.8 * d.shade : 0,
        );
      }
      let n = 0;
      for (const s of splashes) {
        s.age += dt;
        if (s.age > 0.28) continue;
        splashes[n] = s;
        const o = n * 6;
        const k = s.age / 0.28;
        splashData[o] = s.east * origin.ppm;
        splashData[o + 1] = -s.north * origin.ppm;
        splashData[o + 2] = 0.5 * mpp;
        splashData[o + 3] = s.size * (0.6 + k * 1.4);
        splashData[o + 4] = 0.55 * (1 - k);
        splashData[o + 5] = 0;
        n += 1;
      }
      splashes.length = n;
    }
    if (state.snow) {
      while (flakes.length < MAX_SNOW) flakes.push(spawn(origin, "snow", false));
      const fall = 75 * mpp;
      const vx = wind.u * 18 * mpp;
      const vy = wind.v * 18 * mpp;
      const sway = 14 * mpp;
      const t = performance.now() / 1000;
      for (let i = 0; i < flakes.length; i += 1) {
        let f = flakes[i];
        f.east += (vx + Math.sin(t * 1.3 + f.phase) * sway) * dt;
        f.north += (vy + Math.cos(t * 1.1 + f.phase) * sway) * dt;
        f.up -= fall * dt * f.speed;
        if (outside(f)) {
          f = spawn(origin, "snow", true);
          flakes[i] = f;
        }
        const o = i * 6;
        snowData[o] = f.east * origin.ppm;
        snowData[o + 1] = -f.north * origin.ppm;
        snowData[o + 2] = f.up;
        snowData[o + 3] = f.size;
        snowData[o + 4] = f.on ? 0.9 : 0;
        snowData[o + 5] = 0;
      }
    }
  }

  function drawPoints(data, count, matrix, wref) {
    gl.useProgram(snowProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(snowProgram, "u_matrix"), false, matrix);
    gl.uniform1f(gl.getUniformLocation(snowProgram, "u_wref"), wref);
    gl.uniform1f(gl.getUniformLocation(snowProgram, "u_dpr"), window.devicePixelRatio || 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, snowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, count * 6), gl.DYNAMIC_DRAW);
    const pos = gl.getAttribLocation(snowProgram, "a_pos");
    const size = gl.getAttribLocation(snowProgram, "a_size");
    const alpha = gl.getAttribLocation(snowProgram, "a_alpha");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(size);
    gl.vertexAttribPointer(size, 1, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(alpha);
    gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, 24, 16);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disableVertexAttribArray(pos);
    gl.disableVertexAttribArray(size);
    gl.disableVertexAttribArray(alpha);
  }

  function drawRain(matrix, wref) {
    gl.useProgram(rainProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(rainProgram, "u_matrix"), false, matrix);
    gl.uniform1f(gl.getUniformLocation(rainProgram, "u_wref"), wref);
    gl.uniform2f(gl.getUniformLocation(rainProgram, "u_viewport"), gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2);
    gl.uniform3f(gl.getUniformLocation(rainProgram, "u_color"), 0.8, 0.86, 0.93);
    gl.bindBuffer(gl.ARRAY_BUFFER, rainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rainData.subarray(0, drops.length * RAIN_FLOATS), gl.DYNAMIC_DRAW);
    const bytes = RAIN_STRIDE * 4;
    const attrs = [
      ["a_head", 3, 0],
      ["a_tail", 3, 12],
      ["a_end", 1, 24],
      ["a_side", 1, 28],
      ["a_alpha", 1, 32],
    ].map(([name, n, offset]) => {
      const loc = gl.getAttribLocation(rainProgram, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, n, gl.FLOAT, false, bytes, offset);
      return loc;
    });
    gl.drawArrays(gl.TRIANGLES, 0, drops.length * 6);
    for (const loc of attrs) gl.disableVertexAttribArray(loc);
  }

  function relativeMatrix(matrix, origin) {
    const m = Array.from(matrix);
    const out = new Float32Array(16);
    for (let i = 0; i < 12; i += 1) out[i] = m[i];
    for (let r = 0; r < 4; r += 1) {
      out[12 + r] = m[r] * origin.x + m[4 + r] * origin.y + m[8 + r] * origin.z + m[12 + r];
    }
    return out;
  }

  const layer = {
    id: "wx-precip-3d",
    type: "custom",
    renderingMode: "3d",
    onAdd(_map, context) {
      gl = context;
      rainProgram = program(gl, RAIN_VS, RAIN_FS);
      snowProgram = program(gl, SNOW_VS, SNOW_FS);
      rainBuffer = gl.createBuffer();
      snowBuffer = gl.createBuffer();
    },
    render(context, args) {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!state.rain && !state.snow) return;
      if (map.getZoom() < minZoom) return;
      const origin = center();
      step(origin, dt);
      const matrix = relativeMatrix(args.modelViewProjectionMatrix || args, origin);
      const wref = Math.max(0.001, matrix[15]);
      gl.depthMask(false);
      if (state.rain) {
        drawRain(matrix, wref);
        if (splashes.length) drawPoints(splashData, splashes.length, matrix, wref);
      }
      if (state.snow) drawPoints(snowData, flakes.length, matrix, wref);
      gl.depthMask(true);
      map.triggerRepaint();
    },
    onRemove() {
      gl?.deleteBuffer(rainBuffer);
      gl?.deleteBuffer(snowBuffer);
      gl?.deleteProgram(rainProgram);
      gl?.deleteProgram(snowProgram);
    },
  };

  return {
    layer,
    setState(next) {
      const samplerChanged = next.sampler !== state.sampler;
      state = { ...state, ...next };
      if (samplerChanged) {
        drops = [];
        flakes = [];
        splashes = [];
      }
      if (state.rain || state.snow) map.triggerRepaint();
    },
  };
}
