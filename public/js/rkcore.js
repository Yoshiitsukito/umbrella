const RED = "230, 0, 18";
const HOT = "255, 43, 58";
const WHITE = "255, 236, 236";
const INK = "20, 20, 20";
const POINTS = 700;
const CROWN = new Path2D("M4 40 L8 12 L22 26 L32 6 L42 26 L56 12 L60 40 Z M4 41 h56 v5 h-56 Z");
const CAMERA = 5;

const MODES = {
  idle: { glow: 0.25, spin: 1, amp: 0.015, speed: 1.5 },
  listening: { glow: 0.7, spin: 1.6, amp: 0.05, speed: 4 },
  thinking: { glow: 0.85, spin: 4.5, amp: 0.03, speed: 6 },
  speaking: { glow: 1, spin: 1.3, amp: 0.08, speed: 9 },
};

const SPHERE = Array.from({ length: POINTS }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / POINTS;
  const radius = Math.sqrt(1 - y * y);
  const theta = i * Math.PI * (3 - Math.sqrt(5));
  return [Math.cos(theta) * radius, y, Math.sin(theta) * radius];
});

function circle(steps, at) {
  return Array.from({ length: steps + 1 }, (_, i) => at((i / steps) * Math.PI * 2));
}

const LATITUDES = [-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].map((y) => {
  const r = Math.sqrt(1 - y * y);
  return circle(64, (a) => [Math.cos(a) * r, y, Math.sin(a) * r]);
});
const LONGITUDES = Array.from({ length: 8 }, (_, k) => {
  const phi = (k / 8) * Math.PI;
  return circle(64, (a) => [Math.cos(phi) * Math.sin(a), Math.cos(a), Math.sin(phi) * Math.sin(a)]);
});
const ORBIT = circle(96, (a) => [Math.cos(a), 0, Math.sin(a)]);

function rotate([x, y, z], yaw, pitch, roll = 0) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  let x1 = x * cy + z * sy;
  let z1 = -x * sy + z * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y1 = y * cp - z1 * sp;
  z1 = y * sp + z1 * cp;
  if (!roll) return [x1, y1, z1];
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  return [x1 * cr - y1 * sr, x1 * sr + y1 * cr, z1];
}

export function createCore(canvas) {
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let mode = "idle";
  let glow = MODES.idle.glow;
  let spin = MODES.idle.spin;
  let amp = MODES.idle.amp;
  let speed = MODES.idle.speed;
  let angle = 0;
  let phase = 0;
  let last = performance.now();
  let raf = 0;
  let voice = 0;
  let voiceAt = 0;

  function fit() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  function frame(now) {
    if (!canvas.isConnected) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    const live = now - voiceAt < 250;
    const target = MODES[mode] || MODES.idle;
    const targetAmp = mode === "speaking" && live ? 0.025 + Math.min(1, voice * 7) * 0.16 : target.amp;
    const ease = 1 - Math.exp(-dt * 5);
    glow += (target.glow - glow) * ease;
    spin += (target.spin - spin) * ease;
    speed += (target.speed - speed) * ease;
    amp += (targetAmp - amp) * (1 - Math.exp(-dt * (live ? 18 : 5)));
    angle += dt * spin * (reduced ? 0.15 : 0.35);
    phase += dt * speed;

    const light = document.documentElement.dataset.theme === "light";
    const accent = light ? INK : WHITE;
    const { w, h, dpr } = fit();
    const R = Math.min(w, h) / 2;
    const r = R * 0.52;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.lineCap = "round";

    const yaw = angle;
    const pitch = 0.38 + Math.sin(t * 0.4) * 0.08;
    const surface = (p) =>
      1 + amp * (0.6 * Math.sin(phase + p[1] * 6 + p[0] * 2) + 0.4 * Math.sin(phase * 1.45 + p[0] * 7 + p[2] * 5));
    const project = (p, scale = 1) => {
      const k = surface(p) * scale;
      const [x, y, z] = rotate([p[0] * k, p[1] * k, p[2] * k], yaw, pitch);
      const s = CAMERA / (CAMERA - z);
      return { x: x * s * r, y: y * s * r, z, s };
    };

    const halo = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, R);
    halo.addColorStop(0, `rgba(${HOT}, ${0.28 + glow * 0.22})`);
    halo.addColorStop(0.45, `rgba(${RED}, ${0.1 + glow * 0.1})`);
    halo.addColorStop(1, `rgba(${RED}, 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    ctx.strokeStyle = `rgba(${RED}, ${0.3 + glow * 0.2})`;
    for (let i = 0; i < 120; i += 1) {
      const a = angle * 0.3 + (i / 120) * Math.PI * 2;
      const long = i % 10 === 0;
      const r0 = R * (long ? 0.9 : 0.93);
      ctx.lineWidth = long ? 1.6 * dpr : dpr;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * R * 0.96, Math.sin(a) * R * 0.96);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = light ? "source-over" : "lighter";

    const core = ctx.createRadialGradient(-r * 0.25, -r * 0.3, 0, 0, 0, r * 1.05);
    core.addColorStop(0, `rgba(${HOT}, ${(light ? 0.18 : 0.35) + glow * 0.25})`);
    core.addColorStop(0.55, light ? "rgba(230, 0, 18, 0.12)" : "rgba(140, 0, 12, 0.35)");
    core.addColorStop(1, `rgba(${RED}, 0)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, r * surface([0, 0, 1]) * 1.02, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = dpr;
    for (const line of [...LATITUDES, ...LONGITUDES]) {
      let prev = project(line[0]);
      for (let i = 1; i < line.length; i += 1) {
        const next = project(line[i]);
        const depth = (prev.z + next.z + 2) / 4;
        ctx.strokeStyle = `rgba(${RED}, ${0.04 + depth * depth * 0.3})`;
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
        prev = next;
      }
    }

    const band = Math.sin(t * 2.4) * 0.92;
    const scanning = mode === "thinking";
    for (const p of SPHERE) {
      const q = project(p);
      const depth = (q.z + 1) / 2;
      const lit = scanning && Math.abs(p[1] - band) < 0.07;
      const size = (0.8 + depth * 1.6 + (lit ? 1 : 0)) * dpr * q.s;
      const alpha = 0.12 + depth * depth * (0.55 + glow * 0.3);
      ctx.fillStyle = lit ? `rgba(${accent}, ${0.5 + depth * 0.5})` : `rgba(${depth > 0.55 ? HOT : RED}, ${alpha})`;
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }

    const orbits = [
      { tilt: 0.35, roll: 0.55, turn: angle * 1.6, scale: 1.18 },
      { tilt: -0.3, roll: -0.75, turn: -angle * 1.2, scale: 1.28 },
    ];
    ctx.lineWidth = 1.4 * dpr;
    for (const orbit of orbits) {
      let prev = null;
      for (const base of ORBIT) {
        const local = rotate(base, orbit.turn, orbit.tilt, orbit.roll);
        const [x, y, z] = rotate(local.map((v) => v * orbit.scale), yaw * 0.3, pitch);
        const s = CAMERA / (CAMERA - z);
        const next = { x: x * s * r, y: y * s * r, z };
        if (prev) {
          const depth = (prev.z + next.z + orbit.scale * 2) / (orbit.scale * 4);
          ctx.strokeStyle = `rgba(${HOT}, ${0.08 + depth * depth * (0.5 + glow * 0.3)})`;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }
        prev = next;
      }
      const head = rotate(rotate([1, 0, 0], orbit.turn * 2.5, orbit.tilt, orbit.roll).map((v) => v * orbit.scale), yaw * 0.3, pitch);
      const hs = CAMERA / (CAMERA - head[2]);
      ctx.fillStyle = `rgba(${accent}, ${0.4 + ((head[2] + orbit.scale) / (orbit.scale * 2)) * 0.6})`;
      ctx.beginPath();
      ctx.arc(head[0] * hs * r, head[1] * hs * r, 2.6 * dpr * hs, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = "source-over";
    const breathe = 1 + Math.sin(t * 2.2) * 0.02 + amp * 0.6;
    const s = ((r * 0.62) / 64) * breathe;
    ctx.save();
    ctx.scale(s, s);
    ctx.translate(-32, -26);
    ctx.shadowColor = `rgba(${HOT}, ${light ? 0.6 : 0.95})`;
    ctx.shadowBlur = (light ? 8 : 16) + glow * 20;
    ctx.fillStyle = `rgba(${accent}, ${0.8 + glow * 0.2})`;
    ctx.fill(CROWN);
    ctx.restore();

    raf = requestAnimationFrame(frame);
  }

  raf = requestAnimationFrame(frame);

  return {
    setMode(next) {
      mode = MODES[next] ? next : "idle";
    },
    setLevel(level) {
      voice = level;
      voiceAt = performance.now();
    },
    destroy() {
      cancelAnimationFrame(raf);
    },
  };
}
