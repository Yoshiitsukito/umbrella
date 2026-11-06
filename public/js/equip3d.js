// Solid models of the mine fleet. A canvas paints them and turns each one slowly.
const C = {
  yellow: [232, 168, 28],
  yellow2: [186, 124, 14],
  black: [46, 48, 54],
  rubber: [62, 64, 70],
  glass: [126, 186, 206],
  steel: [176, 182, 190],
  dark: [52, 54, 60],
  red: [176, 36, 42],
  orange: [214, 92, 28],
};

const BUILDERS = { truck, excavator, loader, dozer, drill, crane, grader, lv, bus };

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const copy = (point) => [point[0], point[1], point[2]];

function quad(model, a, b, c, d, color) {
  model.faces.push({ pts: [a, b, c, d].map(copy), color });
}

function box(model, x, y, z, w, h, d, color) {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const y0 = y - h / 2;
  const y1 = y + h / 2;
  const z0 = z - d / 2;
  const z1 = z + d / 2;
  const p = (px, py, pz) => [px, py, pz];
  quad(model, p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), color);
  quad(model, p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), color);
  quad(model, p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), color);
  quad(model, p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), color);
  quad(model, p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), color);
  quad(model, p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), color);
}

function beam(model, a, b, w, h, color) {
  const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  dir[0] /= len;
  dir[1] /= len;
  dir[2] /= len;
  const helper = Math.abs(dir[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  let side = cross(dir, helper);
  const sl = Math.hypot(side[0], side[1], side[2]) || 1;
  side = side.map((value) => value / sl);
  let up = cross(side, dir);
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = up.map((value) => value / ul);
  const hw = w / 2;
  const hh = h / 2;
  const corner = (end, su, uu) => {
    const origin = end ? b : a;
    return [
      origin[0] + side[0] * su * hw + up[0] * uu * hh,
      origin[1] + side[1] * su * hw + up[1] * uu * hh,
      origin[2] + side[2] * su * hw + up[2] * uu * hh,
    ];
  };
  const c = [
    corner(0, -1, -1), corner(0, 1, -1), corner(0, 1, 1), corner(0, -1, 1),
    corner(1, -1, -1), corner(1, 1, -1), corner(1, 1, 1), corner(1, -1, 1),
  ];
  quad(model, c[0], c[3], c[2], c[1], color);
  quad(model, c[4], c[5], c[6], c[7], color);
  quad(model, c[3], c[2], c[6], c[7], color);
  quad(model, c[0], c[4], c[5], c[1], color);
  quad(model, c[1], c[5], c[6], c[2], color);
  quad(model, c[0], c[3], c[7], c[4], color);
}

function cyl(model, x, y, z, axis, radius, length, color, sides = 12) {
  const ring = (end) => Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    const u = Math.cos(angle) * radius;
    const v = Math.sin(angle) * radius;
    if (axis === "x") return [x + end, y + u, z + v];
    if (axis === "z") return [x + v, y + u, z + end];
    return [x + u, y + end, z + v];
  });
  const a = ring(-length / 2);
  const b = ring(length / 2);
  const center = (end) => (axis === "x" ? [x + end, y, z] : axis === "z" ? [x, y, z + end] : [x, y + end, z]);
  for (let index = 0; index < sides; index += 1) {
    const next = (index + 1) % sides;
    quad(model, a[index], a[next], b[next], b[index], color);
  }
  const cap = (points, end, flip) => {
    const c = center(end);
    for (let index = 0; index < sides; index += 1) {
      const next = (index + 1) % sides;
      model.faces.push({ pts: (flip ? [c, points[next], points[index]] : [c, points[index], points[next]]).map(copy), color });
    }
  };
  cap(a, -length / 2, true);
  cap(b, length / 2, false);
}

function wheel(model, x, y, z, radius = 0.8, width = 0.48) {
  cyl(model, x, y, z, "x", radius, width, C.rubber, 14);
  cyl(model, x + Math.sign(x || 1) * width * 0.32, y, z, "x", radius * 0.4, width * 0.22, C.steel, 10);
}

function tracks(model, x, y, z, length, height) {
  box(model, x, y, z, height * 0.85, height, length, C.rubber);
  box(model, x, y, z, height * 0.62, height * 0.62, length * 0.78, C.dark);
  cyl(model, x, y, z + length * 0.4, "x", height * 0.42, height * 0.9, C.black, 10);
  cyl(model, x, y, z - length * 0.4, "x", height * 0.42, height * 0.9, C.black, 10);
}

function truck(model) {
  box(model, 0, 0.95, 0.15, 2.5, 0.7, 8.4, C.black);
  box(model, 0, 2.25, -1.2, 4.35, 1.85, 5.7, C.yellow);
  box(model, -2.12, 2.7, -1.2, 0.18, 1.2, 5.55, C.yellow2);
  box(model, 2.12, 2.7, -1.2, 0.18, 1.2, 5.55, C.yellow2);
  box(model, 0, 2.55, -3.95, 4.15, 1.55, 0.18, C.yellow2);
  box(model, -0.2, 1.95, 3.25, 2.7, 1.85, 2.15, C.yellow);
  box(model, -0.2, 2.95, 3.1, 3.05, 0.16, 2.45, C.yellow2);
  box(model, -0.2, 2.15, 4.28, 2.3, 0.95, 0.1, C.glass);
  box(model, -1.48, 2.1, 3.25, 0.1, 0.8, 1.45, C.glass);
  box(model, 1.2, 1.4, 4.15, 0.85, 0.95, 0.55, C.dark);
  box(model, 0, 0.72, 4.45, 3.3, 0.32, 0.28, C.black);
  box(model, -0.2, 3.15, 3.05, 0.28, 0.22, 0.28, C.orange);
  wheel(model, -1.55, 0.9, 2.75, 0.9, 0.52);
  wheel(model, 1.55, 0.9, 2.75, 0.9, 0.52);
  wheel(model, -1.45, 1.02, -0.85, 1.05, 0.5);
  wheel(model, -2.05, 1.02, -0.85, 1.05, 0.5);
  wheel(model, 1.45, 1.02, -0.85, 1.05, 0.5);
  wheel(model, 2.05, 1.02, -0.85, 1.05, 0.5);
  wheel(model, -1.45, 1.02, -2.45, 1.05, 0.5);
  wheel(model, -2.05, 1.02, -2.45, 1.05, 0.5);
  wheel(model, 1.45, 1.02, -2.45, 1.05, 0.5);
  wheel(model, 2.05, 1.02, -2.45, 1.05, 0.5);
}

function excavator(model) {
  tracks(model, -1.4, 0.5, 0, 4.4, 0.9);
  tracks(model, 1.4, 0.5, 0, 4.4, 0.9);
  box(model, 0, 1.5, -0.1, 2.3, 0.85, 2.5, C.yellow);
  box(model, 0, 2.2, -0.55, 2.05, 1.15, 2.05, C.yellow);
  box(model, 0, 1.75, -1.9, 2.2, 1.2, 0.75, C.dark);
  box(model, 0.1, 2.4, 0.9, 1.75, 1.3, 1.3, C.yellow);
  box(model, 0.1, 2.5, 1.52, 1.45, 0.85, 0.08, C.glass);
  box(model, 0.94, 2.45, 0.95, 0.08, 0.8, 1.0, C.glass);
  const boom0 = [0, 2.45, 1.2];
  const boom1 = [0, 4.35, 3.45];
  const stick = [0, 2.35, 5.15];
  beam(model, boom0, boom1, 0.55, 0.7, C.yellow);
  beam(model, boom1, stick, 0.4, 0.48, C.yellow);
  beam(model, [0.4, 2.2, 1.45], [0.4, 3.55, 2.7], 0.14, 0.14, C.steel);
  beam(model, stick, [0, 1.35, 5.65], 1.55, 0.32, C.dark);
  beam(model, [0, 1.35, 5.65], [0, 0.95, 4.95], 1.5, 0.16, C.steel);
}

function loader(model) {
  box(model, 0, 1.2, -0.45, 2.2, 1.15, 3.1, C.yellow);
  box(model, 0, 2.2, -0.15, 2.0, 1.4, 1.85, C.yellow);
  box(model, 0, 2.3, 0.72, 1.65, 0.9, 0.08, C.glass);
  box(model, 1.02, 2.25, -0.1, 0.08, 0.8, 1.2, C.glass);
  box(model, 0, 1.05, 1.45, 1.7, 0.75, 1.2, C.yellow2);
  beam(model, [-0.85, 1.55, 0.35], [-0.85, 2.2, 2.95], 0.28, 0.4, C.yellow);
  beam(model, [0.85, 1.55, 0.35], [0.85, 2.2, 2.95], 0.28, 0.4, C.yellow);
  box(model, 0, 1.2, 3.4, 2.85, 1.2, 0.95, C.yellow2);
  box(model, 0, 0.68, 3.78, 2.9, 0.16, 0.32, C.steel);
  wheel(model, -1.2, 0.95, -1.2, 0.95, 0.55);
  wheel(model, 1.2, 0.95, -1.2, 0.95, 0.55);
  wheel(model, -1.2, 0.95, 1.25, 0.95, 0.55);
  wheel(model, 1.2, 0.95, 1.25, 0.95, 0.55);
}

function dozer(model) {
  tracks(model, -1.15, 0.55, -0.15, 4.2, 1);
  tracks(model, 1.15, 0.55, -0.15, 4.2, 1);
  box(model, 0, 1.45, -0.25, 1.85, 0.8, 2.6, C.yellow);
  box(model, 0, 2.25, 0.2, 1.6, 1.15, 1.45, C.yellow);
  box(model, 0, 2.35, 0.88, 1.3, 0.72, 0.08, C.glass);
  box(model, 0, 1.0, 2.55, 3.7, 1.3, 0.28, C.yellow2);
  beam(model, [-0.55, 1.15, 1.15], [-1.15, 0.95, 2.35], 0.16, 0.18, C.steel);
  beam(model, [0.55, 1.15, 1.15], [1.15, 0.95, 2.35], 0.16, 0.18, C.steel);
  box(model, 0, 0.75, -2.35, 1.5, 0.7, 0.22, C.dark);
  box(model, 0, 2.95, 0.15, 0.22, 0.16, 0.22, C.orange);
}

function drill(model) {
  tracks(model, -1.05, 0.48, -0.2, 3.5, 0.85);
  tracks(model, 1.05, 0.48, -0.2, 3.5, 0.85);
  box(model, 0, 1.25, -0.35, 1.9, 0.8, 2.5, C.yellow);
  box(model, -0.4, 2.05, -0.2, 1.15, 1.15, 1.35, C.yellow);
  box(model, -0.4, 2.15, 0.42, 0.95, 0.7, 0.08, C.glass);
  box(model, 0.72, 3.55, 0.85, 0.42, 5.3, 0.42, C.yellow);
  box(model, 0.72, 6.25, 0.85, 0.7, 0.18, 0.7, C.dark);
  cyl(model, 0.72, 3.3, 1.22, "y", 0.11, 4.8, C.steel, 8);
  box(model, 0.72, 0.78, 1.22, 0.42, 0.22, 0.42, C.dark);
}

function crane(model) {
  box(model, 0, 0.85, 0, 2.15, 0.55, 6.6, C.dark);
  box(model, 0, 1.7, -1.7, 2.05, 1.05, 2.2, C.yellow);
  box(model, 0, 2.45, -1.35, 1.55, 1.05, 1.35, C.yellow);
  box(model, 0, 2.55, -0.72, 1.25, 0.7, 0.08, C.glass);
  box(model, 0, 1.75, -3.0, 1.85, 0.85, 0.7, C.black);
  beam(model, [0, 2.3, -0.7], [0, 6.5, 3.7], 0.34, 0.42, C.yellow);
  beam(model, [0, 2.15, -0.55], [0, 6.25, 3.85], 0.1, 0.1, C.steel);
  beam(model, [0, 6.5, 3.7], [0, 2.7, 3.7], 0.045, 0.045, C.steel);
  box(model, 0, 2.5, 3.7, 0.28, 0.38, 0.18, C.dark);
  box(model, 0, 0.45, 1.7, 4.4, 0.1, 0.16, C.orange);
  box(model, 0, 0.45, -1.3, 4.4, 0.1, 0.16, C.orange);
  for (const z of [-2.4, -1.5, 1.6, 2.5]) {
    wheel(model, -1.15, 0.48, z, 0.48, 0.32);
    wheel(model, 1.15, 0.48, z, 0.48, 0.32);
  }
}

function grader(model) {
  box(model, 0, 0.85, 0.1, 1.25, 0.38, 7.6, C.dark);
  box(model, 0, 1.85, -2.15, 1.8, 1.45, 1.8, C.yellow);
  box(model, 0, 2.0, -1.3, 1.5, 0.85, 0.08, C.glass);
  box(model, 0, 1.25, 2.7, 1.45, 0.85, 1.7, C.yellow);
  box(model, 0, 0.55, 0.2, 3.4, 0.55, 0.16, C.yellow2);
  beam(model, [-0.4, 0.9, -0.8], [-0.9, 0.55, 0.15], 0.12, 0.12, C.steel);
  beam(model, [0.4, 0.9, -0.8], [0.9, 0.55, 0.15], 0.12, 0.12, C.steel);
  wheel(model, -0.85, 0.62, 3.15, 0.62, 0.36);
  wheel(model, 0.85, 0.62, 3.15, 0.62, 0.36);
  for (const z of [-1.15, -2.15]) {
    wheel(model, -0.95, 0.7, z, 0.7, 0.4);
    wheel(model, 0.95, 0.7, z, 0.7, 0.4);
  }
}

function lv(model) {
  box(model, 0, 0.62, -0.15, 1.75, 0.55, 4.3, C.dark);
  box(model, 0, 1.15, -0.7, 1.7, 0.7, 2.15, C.yellow);
  box(model, 0, 1.55, 0.85, 1.6, 0.85, 1.55, C.yellow);
  box(model, 0, 1.65, 1.58, 1.4, 0.6, 0.08, C.glass);
  box(model, 0.82, 1.55, 0.85, 0.08, 0.5, 1.15, C.glass);
  box(model, -0.82, 1.55, 0.85, 0.08, 0.5, 1.15, C.glass);
  wheel(model, -0.9, 0.42, 1.35, 0.42, 0.28);
  wheel(model, 0.9, 0.42, 1.35, 0.42, 0.28);
  wheel(model, -0.9, 0.42, -1.35, 0.42, 0.28);
  wheel(model, 0.9, 0.42, -1.35, 0.42, 0.28);
}

function bus(model) {
  box(model, 0, 1.45, 0, 2.35, 2.15, 7.5, C.yellow);
  box(model, 0, 1.7, 3.7, 2.05, 1.05, 0.08, C.glass);
  box(model, 0, 1.55, -3.7, 2.05, 0.7, 0.08, C.glass);
  box(model, -1.18, 1.75, -0.15, 0.06, 0.7, 5.6, C.glass);
  box(model, 1.18, 1.75, -0.15, 0.06, 0.7, 5.6, C.glass);
  box(model, 0, 0.85, 0, 2.4, 0.16, 7.4, C.red);
  for (const z of [-2.3, 2.2]) {
    wheel(model, -1.15, 0.48, z, 0.48, 0.32);
    wheel(model, 1.15, 0.48, z, 0.48, 0.32);
  }
}

function settle(model) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const face of model.faces) {
    for (const point of face.pts) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
  }
  const shift = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const face of model.faces) {
    for (const point of face.pts) {
      point[0] -= shift[0];
      point[1] -= shift[1];
      point[2] -= shift[2];
    }
  }
  model.span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  model.look = (max[1] - min[1]) * 0.46;
  model.ground = Math.max(max[0] - min[0], max[2] - min[2]) * 0.62;
}

function buildModel(type) {
  const model = { faces: [] };
  (BUILDERS[type] || lv)(model);
  settle(model);
  return model;
}

function toCamera(point, yaw, pitch, look) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = point[0] * cy + point[2] * sy;
  const y0 = point[1] - look;
  const z0 = -point[0] * sy + point[2] * cy;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x, y0 * cp - z0 * sp, y0 * sp + z0 * cp];
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function drawBackdrop(ctx, width, height) {
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, "#07111e");
  sky.addColorStop(0.5, "#0b2748");
  sky.addColorStop(1, "#061018");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createRadialGradient(width * 0.5, height * 0.4, 8, width * 0.5, height * 0.42, width * 0.62);
  haze.addColorStop(0, "rgba(46, 150, 255, 0.28)");
  haze.addColorStop(0.55, "rgba(18, 70, 150, 0.08)");
  haze.addColorStop(1, "rgba(8, 20, 40, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.strokeStyle = "rgba(70, 150, 220, 0.13)";
  ctx.lineWidth = 1;
  const step = Math.max(26, Math.round(width / 16));
  ctx.beginPath();
  for (let x = step * 0.5; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = step * 0.5; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(150, 210, 255, 0.35)";
  for (let index = 0; index < 16; index += 1) {
    const x = ((index * 97) % 100) / 100 * width;
    const y = ((index * 53) % 80) / 100 * height;
    ctx.beginPath();
    ctx.arc(x, y, index % 4 === 0 ? 2.2 : 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paint(ctx, width, height, model, yaw) {
  drawBackdrop(ctx, width, height);

  const pitch = 0.36;
  const dist = model.span * 2.2;
  const focal = (Math.min(width * 0.72, height * 0.78) / model.span) * dist;
  const project = (point, spin) => {
    const [x, y, z] = toCamera(point, spin, pitch, model.look);
    const scale = focal / (dist - z);
    return [width / 2 + x * scale, height * 0.6 - y * scale, z];
  };

  const pad = project([0, 0, 0], 0);
  const rx = Math.hypot(project([model.ground, 0, 0], 0)[0] - pad[0], project([model.ground, 0, 0], 0)[1] - pad[1]);
  const ry = Math.hypot(project([0, 0, model.ground], 0)[0] - pad[0], project([0, 0, model.ground], 0)[1] - pad[1]);
  const disc = ctx.createRadialGradient(pad[0], pad[1], rx * 0.05, pad[0], pad[1], rx);
  disc.addColorStop(0, "rgba(90, 190, 255, 0.34)");
  disc.addColorStop(0.45, "rgba(16, 70, 130, 0.28)");
  disc.addColorStop(1, "rgba(6, 16, 32, 0.05)");
  ctx.beginPath();
  ctx.ellipse(pad[0], pad[1], rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = disc;
  ctx.fill();
  ctx.lineCap = "round";
  const rings = [
    [1, "rgba(120, 214, 255, 0.95)", Math.max(1.6, width / 280)],
    [0.78, "rgba(80, 180, 255, 0.55)", Math.max(1, width / 420)],
    [0.52, "rgba(150, 220, 255, 0.4)", Math.max(1, width / 480)],
    [1.16, "rgba(70, 160, 230, 0.28)", Math.max(1, width / 500)],
  ];
  for (const [scale, color, line] of rings) {
    ctx.beginPath();
    ctx.ellipse(pad[0], pad[1], rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = line;
    ctx.stroke();
  }
  ctx.beginPath();
  for (let index = 0; index < 56; index += 1) {
    const angle = (index / 56) * Math.PI * 2;
    const inner = index % 7 === 0 ? 0.86 : 0.94;
    const a = project([Math.cos(angle) * model.ground * inner, 0, Math.sin(angle) * model.ground * inner], 0);
    const b = project([Math.cos(angle) * model.ground * 1.05, 0, Math.sin(angle) * model.ground * 1.05], 0);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.strokeStyle = "rgba(170, 230, 255, 0.75)";
  ctx.lineWidth = Math.max(1, width / 520);
  ctx.stroke();

  const seen = new Set();
  const front = [];
  const back = [];
  const mesh = [];
  const pointKey = (point) => `${point[0].toFixed(2)},${point[1].toFixed(2)},${point[2].toFixed(2)}`;
  for (const face of model.faces) {
    if (face.pts.length < 4) continue;
    const cam = face.pts.map((point) => toCamera(point, yaw, pitch, model.look));
    const e1 = [cam[1][0] - cam[0][0], cam[1][1] - cam[0][1], cam[1][2] - cam[0][2]];
    const e2 = [cam[2][0] - cam[0][0], cam[2][1] - cam[0][1], cam[2][2] - cam[0][2]];
    const normal = cross(e1, e2);
    const length = Math.hypot(normal[0], normal[1], normal[2]) || 1;
    const facing = normal[2] / length > 0.04;
    const bucket = facing ? front : back;
    for (let index = 0; index < face.pts.length; index += 1) {
      const next = (index + 1) % face.pts.length;
      const ka = pointKey(face.pts[index]);
      const kb = pointKey(face.pts[next]);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bucket.push([project(face.pts[index], yaw), project(face.pts[next], yaw)]);
    }
    if (!facing || face.pts.length !== 4) continue;
    const span = Math.hypot(face.pts[1][0] - face.pts[0][0], face.pts[1][1] - face.pts[0][1], face.pts[1][2] - face.pts[0][2]);
    const divisions = span > 1.3 ? 4 : span > 0.45 ? 2 : 0;
    for (let step = 1; step < divisions; step += 1) {
      const t = step / divisions;
      const acrossA = lerp(face.pts[0], face.pts[1], t);
      const acrossB = lerp(face.pts[3], face.pts[2], t);
      const alongA = lerp(face.pts[0], face.pts[3], t);
      const alongB = lerp(face.pts[1], face.pts[2], t);
      mesh.push([project(acrossA, yaw), project(acrossB, yaw)]);
      mesh.push([project(alongA, yaw), project(alongB, yaw)]);
    }
  }

  const trace = (lines) => {
    ctx.beginPath();
    for (const [a, b] of lines) {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(70, 160, 220, 0.28)";
  ctx.lineWidth = Math.max(1, width / 700);
  trace(back);
  ctx.strokeStyle = "rgba(70, 170, 255, 0.22)";
  ctx.lineWidth = Math.max(2.4, width / 220);
  trace(front);
  ctx.strokeStyle = "rgba(186, 236, 255, 0.95)";
  ctx.lineWidth = Math.max(1.05, width / 560);
  trace(front);
  ctx.strokeStyle = "rgba(120, 210, 255, 0.55)";
  ctx.lineWidth = Math.max(0.8, width / 800);
  trace(mesh);
}

/** Starts a slow turntable on `canvas` for an equipment type. Returns a stop function. */
export function startEquipModel(canvas, type) {
  const model = buildModel(type);
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const speed = reduced ? 0 : (Math.PI * 2) / 22;
  let raf = 0;
  let yaw = 0.75;
  let last = 0;

  const frame = (time) => {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.05, (time - last) / 1000) : 0;
    last = time;
    yaw += speed * dt;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    paint(ctx, width, height, model, yaw);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
