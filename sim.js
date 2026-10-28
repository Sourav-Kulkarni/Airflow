'use strict';
/*
 * Simplified 2D (top-down) incompressible air flow solver — Stam "stable fluids" on a
 * cell-centred grid. Walls are solid cells, openings carve gaps, the domain edge is open
 * (p = 0) with a wind "nudge" band on the upwind sides. Devices (standing fan, AC,
 * ceiling fan) are momentum / temperature / divergence sources.
 *
 * Units: metres, seconds, m/s, degrees C. Angle 0 = +x (east), 90 = +y (down on screen).
 */

var WORLD = { w: 22, h: 15 };

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

// How pleasant is an air speed at body height? 0..1 (peak plateau 0.8-2 m/s).
function comfortOf(s) {
  if (s < 0.8) return s / 0.8;
  if (s < 2) return 1;
  return Math.max(0, 1 - (s - 2) / 1.5);
}

class Sim {
  constructor(cell, opts) {
    opts = opts || {};
    this.cell = cell;
    this.nx = Math.ceil(WORLD.w / cell - 1e-6);
    this.ny = Math.ceil(WORLD.h / cell - 1e-6);
    const n = this.n = this.nx * this.ny;
    const F = () => new Float32Array(n), B = () => new Uint8Array(n);
    this.u = F(); this.v = F(); this.u0 = F(); this.v0 = F();
    this.p = F(); this.div = F(); this.srcDiv = F();
    this.T = F(); this.T0 = F();
    this.solid = B();    // blocks air
    this.barrier = B();  // wall or opening (used to find enclosed rooms)
    this.outside = B();  // connected to the domain edge without crossing a wall/opening
    this.indoor = B();
    this.indoorList = new Int32Array(0);
    this.dt = opts.dt || 0.05;
    this.iters = opts.iters || 18;
    this.time = 0;
    this.env = { windDir: 270, windSpeed: 2, gust: 0, tOut: 32, tIn: 32, wallHeat: 0.5 };
    this.devices = [];
    this._stack = new Int32Array(n);
    this.T.fill(this.env.tOut);
  }

  tIn() { return this.env.tIn == null ? this.env.tOut : this.env.tIn; }

  // Fresh air field: outdoors at ambient, rooms at the (heat-soaked) indoor temperature.
  resetTemp() {
    const tIn = this.tIn(), tOut = this.env.tOut;
    for (let c = 0; c < this.n; c++) this.T[c] = this.indoor[c] ? tIn : tOut;
  }

  reset() {
    this.u.fill(0); this.v.fill(0); this.p.fill(0);
    this.resetTemp();
  }

  // ---------------------------------------------------------------- geometry
  _stamp(x1, y1, x2, y2, rad, capsule, fn) {
    const { nx, ny, cell: h } = this;
    const i0 = Math.max(0, Math.floor((Math.min(x1, x2) - rad) / h));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(x1, x2) + rad) / h));
    const j0 = Math.max(0, Math.floor((Math.min(y1, y2) - rad) / h));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(y1, y2) + rad) / h));
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy, r2 = rad * rad;
    for (let j = j0; j <= j1; j++) {
      const py = (j + 0.5) * h;
      for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * h;
        let t = L2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / L2 : 0;
        if (capsule) t = clamp(t, 0, 1); else if (t < 0 || t > 1) continue;
        const cx = x1 + t * dx - px, cy = y1 + t * dy - py;
        if (cx * cx + cy * cy <= r2) fn(j * nx + i);
      }
    }
  }

  // Rasterise walls/openings. Fields are kept (so editing doesn't restart the flow).
  build(scene) {
    const { nx, ny, cell: h, solid, barrier, outside, indoor } = this;
    solid.fill(0); barrier.fill(0); outside.fill(0); indoor.fill(0);
    const rad = Math.max((scene.wallT || 0.15) / 2, h * 0.75);
    const setWall = i => { solid[i] = 1; barrier[i] = 1; };
    const setBar = i => { barrier[i] = 1; };
    const clr = i => { solid[i] = 0; };
    for (const w of scene.walls) this._stamp(w.x1, w.y1, w.x2, w.y2, rad, true, setWall);
    for (const o of scene.openings) {
      const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
      if (Math.hypot(dx, dy) < 0.05) continue;
      this._stamp(o.x1, o.y1, o.x2, o.y2, rad + h * 0.3, false, setBar);
      const f = clamp(o.open, 0, 1);
      if (f <= 0) continue;
      const mx = (o.x1 + o.x2) / 2, my = (o.y1 + o.y2) / 2;
      this._stamp(mx - dx * f / 2, my - dy * f / 2, mx + dx * f / 2, my + dy * f / 2, rad + h * 0.3, false, clr);
    }
    // flood-fill the outside from the domain border
    const st = this._stack; let sp = 0;
    const push = i => { if (!barrier[i] && !outside[i]) { outside[i] = 1; st[sp++] = i; } };
    for (let i = 0; i < nx; i++) { push(i); push((ny - 1) * nx + i); }
    for (let j = 0; j < ny; j++) { push(j * nx); push(j * nx + nx - 1); }
    while (sp > 0) {
      const c = st[--sp], i = c % nx, j = (c / nx) | 0;
      if (i > 0) push(c - 1);
      if (i < nx - 1) push(c + 1);
      if (j > 0) push(c - nx);
      if (j < ny - 1) push(c + nx);
    }
    let cnt = 0;
    for (let c = 0; c < this.n; c++) {
      if (!solid[c] && !barrier[c] && !outside[c]) { indoor[c] = 1; cnt++; }
      if (solid[c]) { this.u[c] = 0; this.v[c] = 0; }
    }
    this.indoorList = new Int32Array(cnt);
    let k = 0;
    for (let c = 0; c < this.n; c++) if (indoor[c]) this.indoorList[k++] = c;
  }

  cellAt(x, y) {
    const i = clamp(Math.floor(x / this.cell), 0, this.nx - 1), j = clamp(Math.floor(y / this.cell), 0, this.ny - 1);
    return j * this.nx + i;
  }
  isIndoorAt(x, y) {
    if (x < 0 || y < 0 || x >= this.nx * this.cell || y >= this.ny * this.cell) return false;
    return this.indoor[this.cellAt(x, y)] === 1;
  }
  isSolidAt(x, y) {
    if (x < 0 || y < 0 || x >= this.nx * this.cell || y >= this.ny * this.cell) return false;
    return this.solid[this.cellAt(x, y)] === 1;
  }

  // Bilinear velocity sample -> out[0], out[1]
  sample(x, y, out) {
    const { nx, ny, cell: h, u, v } = this;
    let gx = clamp(x / h - 0.5, 0, nx - 1.001), gy = clamp(y / h - 0.5, 0, ny - 1.001);
    const i0 = gx | 0, j0 = gy | 0, fx = gx - i0, fy = gy - j0, a = j0 * nx + i0;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    out[0] = u[a] * w00 + u[a + 1] * w10 + u[a + nx] * w01 + u[a + nx + 1] * w11;
    out[1] = v[a] * w00 + v[a + 1] * w10 + v[a + nx] * w01 + v[a + nx + 1] * w11;
  }

  // ---------------------------------------------------------------- stepping
  step() {
    const dt = this.dt;
    this._advect(this.u0, this.u, true); this._advect(this.v0, this.v, true);
    let t = this.u; this.u = this.u0; this.u0 = t;
    t = this.v; this.v = this.v0; this.v0 = t;
    const damp = 1 - 0.015 * dt, u = this.u, v = this.v;
    for (let i = 0; i < this.n; i++) { u[i] *= damp; v[i] *= damp; }
    this.srcDiv.fill(0);
    this._wind();
    this._devices();
    this._project();
    this._advect(this.T0, this.T, false);
    t = this.T; this.T = this.T0; this.T0 = t;
    this._tempPass();
    this.time += dt;
  }

  _advect(dst, src, vel) {
    const { nx, ny, solid, u, v } = this, k = this.dt / this.cell;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) { dst[idx] = vel ? 0 : src[idx]; continue; }
        let x = i - k * u[idx], y = j - k * v[idx];
        x = x < 0 ? 0 : x > nx - 1.001 ? nx - 1.001 : x;
        y = y < 0 ? 0 : y > ny - 1.001 ? ny - 1.001 : y;
        const i0 = x | 0, j0 = y | 0, fx = x - i0, fy = y - j0, a = j0 * nx + i0;
        let w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        // ignore solid samples so air slips along walls instead of being dragged to zero
        if (solid[a]) w00 = 0;
        if (solid[a + 1]) w10 = 0;
        if (solid[a + nx]) w01 = 0;
        if (solid[a + nx + 1]) w11 = 0;
        const ws = w00 + w10 + w01 + w11;
        dst[idx] = ws > 1e-5 ? (src[a] * w00 + src[a + 1] * w10 + src[a + nx] * w01 + src[a + nx + 1] * w11) / ws : src[idx];
      }
    }
  }

  _project() {
    const { nx, ny, cell: h, u, v, p, div, solid, srcDiv } = this;
    const inv2h = 1 / (2 * h), hh = h * h;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) { div[idx] = 0; continue; }
        const ue = i < nx - 1 ? u[idx + 1] : u[idx], uw = i > 0 ? u[idx - 1] : u[idx];
        const vs = j < ny - 1 ? v[idx + nx] : v[idx], vn = j > 0 ? v[idx - nx] : v[idx];
        div[idx] = (ue - uw + vs - vn) * inv2h - srcDiv[idx];
      }
    }
    for (let it = 0; it < this.iters; it++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const idx = j * nx + i;
          if (solid[idx]) continue;
          let s = 0, c = 0;
          if (i > 0) { if (!solid[idx - 1]) { s += p[idx - 1]; c++; } } else c++;
          if (i < nx - 1) { if (!solid[idx + 1]) { s += p[idx + 1]; c++; } } else c++;
          if (j > 0) { if (!solid[idx - nx]) { s += p[idx - nx]; c++; } } else c++;
          if (j < ny - 1) { if (!solid[idx + nx]) { s += p[idx + nx]; c++; } } else c++;
          p[idx] = c > 0 ? (s - div[idx] * hh) / c : 0;
        }
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) { u[idx] = 0; v[idx] = 0; continue; }
        const pc = p[idx];
        const pe = i < nx - 1 ? (solid[idx + 1] ? pc : p[idx + 1]) : 0;
        const pw = i > 0 ? (solid[idx - 1] ? pc : p[idx - 1]) : 0;
        const ps = j < ny - 1 ? (solid[idx + nx] ? pc : p[idx + nx]) : 0;
        const pn = j > 0 ? (solid[idx - nx] ? pc : p[idx - nx]) : 0;
        let uu = u[idx] - (pe - pw) * inv2h, vv = v[idx] - (ps - pn) * inv2h;
        // no penetration into walls
        if (uu > 0 && i < nx - 1 && solid[idx + 1]) uu = 0;
        if (uu < 0 && i > 0 && solid[idx - 1]) uu = 0;
        if (vv > 0 && j < ny - 1 && solid[idx + nx]) vv = 0;
        if (vv < 0 && j > 0 && solid[idx - nx]) vv = 0;
        u[idx] = uu; v[idx] = vv;
      }
    }
  }

  _tempPass() {
    const { nx, ny, solid, outside, T, T0, indoor } = this, tOut = this.env.tOut, tMass = this.tIn();
    // Hot concrete keeps re-heating the room air toward the wall temperature.
    const relax = clamp(this.env.wallHeat == null ? 0.5 : this.env.wallHeat, 0, 1) * this.dt / 120;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        if (solid[idx]) { T0[idx] = tOut; continue; }
        if (outside[idx]) { T0[idx] = tOut; continue; }
        let s = 0, c = 0;
        if (i > 0 && !solid[idx - 1]) { s += T[idx - 1]; c++; }
        if (i < nx - 1 && !solid[idx + 1]) { s += T[idx + 1]; c++; }
        if (j > 0 && !solid[idx - nx]) { s += T[idx - nx]; c++; }
        if (j < ny - 1 && !solid[idx + nx]) { s += T[idx + nx]; c++; }
        let t = c ? T[idx] + 0.05 * (s / c - T[idx]) : T[idx];
        if (indoor[idx]) t += (tMass - t) * relax;
        T0[idx] = t;
      }
    }
    this.T = T0; this.T0 = T;
  }

  // ---------------------------------------------------------------- sources
  _nudge(idx, k, tx, ty) {
    this.u[idx] += (tx - this.u[idx]) * k;
    this.v[idx] += (ty - this.v[idx]) * k;
  }

  _wind() {
    const e = this.env;
    const g = e.gust * (Math.sin(this.time * 0.35) + 0.6 * Math.sin(this.time * 0.9 + 1.3)) / 1.6;
    const sp = Math.max(0, e.windSpeed * (1 + g));
    if (sp < 0.001) return;
    const th = e.windDir * Math.PI / 180;
    const ux = -Math.sin(th), uy = Math.cos(th), wx = ux * sp, wy = uy * sp;
    const { nx, ny, solid } = this, B = 4;
    const kL = 0.5 * clamp(0.3 + ux, 0, 1), kR = 0.5 * clamp(0.3 - ux, 0, 1);
    const kT = 0.5 * clamp(0.3 + uy, 0, 1), kB = 0.5 * clamp(0.3 - uy, 0, 1);
    for (let b = 0; b < B; b++) {
      const f = 1 - b / (B + 1);
      for (let j = 0; j < ny; j++) {
        let i = b, idx = j * nx + i;
        if (!solid[idx]) this._nudge(idx, kL * f, wx, wy);
        i = nx - 1 - b; idx = j * nx + i;
        if (!solid[idx]) this._nudge(idx, kR * f, wx, wy);
      }
      for (let i = 0; i < nx; i++) {
        let idx = b * nx + i;
        if (!solid[idx]) this._nudge(idx, kT * f, wx, wy);
        idx = (ny - 1 - b) * nx + i;
        if (!solid[idx]) this._nudge(idx, kB * f, wx, wy);
      }
    }
  }

  _devices() {
    for (const d of this.devices) {
      if (!d.on) continue;
      if (d.type === 'fan') this._fan(d);
      else if (d.type === 'ac') this._ac(d);
      else if (d.type === 'ceil') this._ceil(d);
    }
  }

  _bbox(x, y, r) {
    const h = this.cell;
    return [Math.max(0, Math.floor((x - r) / h)), Math.min(this.nx - 1, Math.floor((x + r) / h)),
            Math.max(0, Math.floor((y - r) / h)), Math.min(this.ny - 1, Math.floor((y + r) / h))];
  }

  _fan(d) {
    let a = d.angle;
    if (d.osc) a += (d.oscRange || 60) / 2 * Math.sin(2 * Math.PI * this.time / (d.oscPeriod || 8));
    a *= Math.PI / 180;
    const dx = Math.cos(a), dy = Math.sin(a), sp = d.speed, h = this.cell;
    const [i0, i1, j0, j1] = this._bbox(d.x, d.y, 0.9);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.nx + i;
        if (this.solid[idx]) continue;
        const rx = (i + 0.5) * h - d.x, ry = (j + 0.5) * h - d.y;
        const ahead = rx * dx + ry * dy;
        if (ahead < 0.05 || ahead > 0.75) continue;
        const lat = -rx * dy + ry * dx, sig = 0.17 + 0.12 * ahead;
        const w = Math.exp(-lat * lat / (2 * sig * sig));
        if (w < 0.05) continue;
        const fall = ahead < 0.35 ? 1 : 1 - (ahead - 0.35) / 0.4;
        this._nudge(idx, 0.65 * w * fall, dx * sp, dy * sp);
      }
    }
  }

  _ac(d) {
    const a = d.angle * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), h = this.cell;
    const hw = (d.width || 0.9) / 2;
    const [i0, i1, j0, j1] = this._bbox(d.x, d.y, hw + 0.6);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.nx + i;
        if (this.solid[idx]) continue;
        const rx = (i + 0.5) * h - d.x, ry = (j + 0.5) * h - d.y;
        const ahead = rx * dx + ry * dy, lat = Math.abs(-rx * dy + ry * dx);
        if (ahead < 0 || ahead > 0.3 || lat > hw + 0.1) continue;
        const k = 0.7 * (lat < hw ? 1 : 1 - (lat - hw) / 0.1);
        this._nudge(idx, k, dx * d.speed, dy * d.speed);
        this.T[idx] += (d.temp - this.T[idx]) * k;
      }
    }
  }

  // Swirl + (zero-net) vertical circulation: downdraft in the disc, return flow in a ring.
  _ceil(d) {
    const R = d.radius || 0.65, h = this.cell, dir = d.dir >= 0 ? 1 : -1, tip = d.speed;
    const S = 2 * (0.5 * tip) / R;
    const [i0, i1, j0, j1] = this._bbox(d.x, d.y, R * 2.5);
    const disc = [], ring = [];
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.nx + i;
        if (this.solid[idx]) continue;
        const rx = (i + 0.5) * h - d.x, ry = (j + 0.5) * h - d.y, r = Math.hypot(rx, ry);
        if (r < 1.3 * R) {
          const vt = tip * Math.min(r / R, 1) * (r < R ? 1 : Math.max(0, 1 - (r - R) / (0.3 * R)));
          const inv = r > 1e-6 ? dir / r : 0;
          this._nudge(idx, 0.15, -ry * inv * vt, rx * inv * vt);
        }
        if (r < R) disc.push(idx); else if (r < 2.5 * R) ring.push(idx);
      }
    }
    if (disc.length && ring.length) {
      const rv = -S * disc.length / ring.length;
      for (const idx of disc) this.srcDiv[idx] += S;
      for (const idx of ring) this.srcDiv[idx] += rv;
    }
  }

  // ---------------------------------------------------------------- metrics
  metrics(zones) {
    const { u, v, T, indoorList: L } = this;
    if (!L.length) return null;
    let sS = 0, sT = 0, stag = 0, comf = 0;
    for (let k = 0; k < L.length; k++) {
      const c = L[k], s = Math.hypot(u[c], v[c]);
      sS += s; sT += T[c];
      if (s < 0.05) stag++;
      if (s >= 0.2 && s <= 2) comf++;
    }
    const n = L.length, h = this.cell;
    const zs = (zones || []).map(z => {
      let c = 0, ss = 0, tt = 0;
      const [i0, i1, j0, j1] = this._bbox((z.x + z.x + z.w) / 2, (z.y + z.y + z.h) / 2, Math.max(z.w, z.h));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = (i + 0.5) * h, py = (j + 0.5) * h, idx = j * this.nx + i;
        if (px < z.x || px > z.x + z.w || py < z.y || py > z.y + z.h || !this.indoor[idx]) continue;
        c++; ss += Math.hypot(u[idx], v[idx]); tt += T[idx];
      }
      return c ? { id: z.id, speed: ss / c, temp: tt / c } : { id: z.id, speed: 0, temp: this.tIn() };
    });
    return { area: n * h * h, speed: sS / n, temp: sT / n, stagnant: stag / n, comfort: comf / n, zones: zs };
  }
}

/*
 * Searches for the best standing-fan position/angle. Runs a coarse copy of the scene:
 * warm up everything except the fan, snapshot, then for every candidate restore the
 * snapshot, add the fan and run a short transient, scoring comfort in the target region.
 * Call step(budgetMs) repeatedly; result is available when .done.
 */
class FanOptimizer {
  constructor(scene, target, template) {
    this.sim = new Sim(0.3, { dt: 0.1, iters: 14 });
    const s = this.sim;
    s.env = scene.env;
    s.build(scene);
    s.resetTemp();
    s.devices = scene.devices.filter(d => d !== target).map(d => Object.assign({}, d));
    this.speed = template.speed;
    this.zones = scene.zones;
    this.hasAC = s.devices.some(d => d.type === 'ac' && d.on);
    this.warmLeft = 150;
    this.phase = 'warm';
    this.done = false;
    this.evals = [];
    this.queue = [];
    this.qi = 0;
    this.total = 1;
    this.target = target;
    this.curScore = null;
    this.baseScore = null;
    this.region = this._region();
    this.regionIsZones = scene.zones.length > 0;
  }

  _region() {
    const s = this.sim, h = s.cell;
    if (!this.zones.length) return Array.from(s.indoorList);
    const set = new Set();
    for (const z of this.zones) {
      for (let j = Math.floor(z.y / h); j <= Math.floor((z.y + z.h) / h); j++) {
        for (let i = Math.floor(z.x / h); i <= Math.floor((z.x + z.w) / h); i++) {
          if (i < 0 || j < 0 || i >= s.nx || j >= s.ny) continue;
          const idx = j * s.nx + i;
          if (s.indoor[idx]) set.add(idx);
        }
      }
    }
    return set.size ? Array.from(set) : Array.from(s.indoorList);
  }

  _score() {
    const s = this.sim, R = this.region;
    if (!R.length) return 0;
    const tRef = s.tIn();
    let acc = 0;
    for (let k = 0; k < R.length; k++) {
      const c = R[k];
      const w = comfortOf(Math.hypot(s.u[c], s.v[c]));
      if (this.hasAC && tRef > 26) {
        const cool = clamp((tRef - s.T[c]) / (tRef - 26), 0, 1);
        acc += 0.6 * w + 0.4 * cool;
      } else acc += w;
    }
    return acc / R.length;
  }

  _clear(x, y) {
    const s = this.sim;
    if (!s.isIndoorAt(x, y)) return false;
    for (let a = 0; a < 8; a++) {
      const t = a * Math.PI / 4;
      if (!s.isIndoorAt(x + 0.4 * Math.cos(t), y + 0.4 * Math.sin(t))) return false;
    }
    for (const z of this.zones) if (x >= z.x - 0.2 && x <= z.x + z.w + 0.2 && y >= z.y - 0.2 && y <= z.y + z.h + 0.2) return false;
    return true;
  }

  _snapshot() {
    const s = this.sim;
    this.snap = { u: s.u.slice(), v: s.v.slice(), p: s.p.slice(), T: s.T.slice(), time: s.time };
  }

  _eval(x, y, angle) {
    const s = this.sim, sn = this.snap;
    s.u.set(sn.u); s.v.set(sn.v); s.p.set(sn.p); s.T.set(sn.T); s.time = sn.time;
    s.devices = this.baseDevices.concat([{ type: 'fan', x, y, angle, speed: this.speed, on: true, osc: false }]);
    let acc = 0, n = 0;
    for (let i = 0; i < 24; i++) {
      s.step();
      if (i >= 16) { acc += this._score(); n++; }
    }
    return acc / n;
  }

  _afterWarm() {
    const s = this.sim;
    this.baseScore = this._score();
    this._snapshot();
    this.baseDevices = s.devices;
    if (this.target) this.curScore = this._eval(this.target.x, this.target.y, this.target.angle);
    const q = [];
    for (let x = 0.5; x < WORLD.w; x += 1.0) {
      for (let y = 0.5; y < WORLD.h; y += 1.0) {
        if (!this._clear(x, y)) continue;
        for (let a = 0; a < 360; a += 45) q.push({ x, y, angle: a });
      }
    }
    this.queue = q; this.qi = 0; this.total = q.length + 120; this.stage = 'coarse';
    this.phase = 'eval';
    if (!q.length) this._finish();
  }

  _bestPerPos() {
    const m = new Map();
    for (const e of this.evals) {
      const key = e.x.toFixed(2) + ',' + e.y.toFixed(2), b = m.get(key);
      if (!b || e.score > b.score) m.set(key, e);
    }
    return Array.from(m.values());
  }

  _evalNext() {
    if (this.qi >= this.queue.length) {
      if (this.stage === 'coarse') {
        const top = this._bestPerPos().sort((a, b) => b.score - a.score).slice(0, 5);
        const q = [];
        for (const t of top) {
          for (let dx = -0.5; dx <= 0.5; dx += 0.5) {
            for (let dy = -0.5; dy <= 0.5; dy += 0.5) {
              const x = t.x + dx, y = t.y + dy;
              if (!this._clear(x, y)) continue;
              for (const da of (dx === 0 && dy === 0 ? [-22.5, 22.5] : [-22.5, 0, 22.5])) {
                q.push({ x, y, angle: (t.angle + da + 360) % 360 });
              }
            }
          }
        }
        this.stage = 'refine'; this.queue = q; this.qi = 0;
        this.total = this.evals.length + q.length;
        if (q.length) return;
      }
      this._finish();
      return;
    }
    const c = this.queue[this.qi++];
    this.evals.push({ x: c.x, y: c.y, angle: c.angle, score: this._eval(c.x, c.y, c.angle) });
  }

  _finish() {
    const sorted = this.evals.slice().sort((a, b) => b.score - a.score), best = [];
    for (const e of sorted) {
      if (best.every(b => Math.hypot(b.x - e.x, b.y - e.y) >= 1.2)) best.push(e);
      if (best.length >= 3) break;
    }
    this.result = {
      base: this.baseScore, cur: this.curScore, best, map: this._bestPerPos(),
      zones: this.regionIsZones, ac: this.hasAC,
    };
    this.done = true;
  }

  progress() {
    if (this.phase === 'warm') return 0.1 * (1 - this.warmLeft / 150);
    return Math.min(1, 0.1 + 0.9 * this.evals.length / Math.max(1, this.total));
  }

  step(budgetMs) {
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < budgetMs) {
      if (this.phase === 'warm') {
        this.sim.step();
        if (--this.warmLeft <= 0) this._afterWarm();
      } else this._evalNext();
    }
    return this.done ? 1 : this.progress();
  }
}

if (typeof module !== 'undefined') module.exports = { Sim, FanOptimizer, WORLD, comfortOf };
