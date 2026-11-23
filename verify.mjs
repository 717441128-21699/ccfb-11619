// src/wind.ts
var Wind = class {
  constructor(rnd = Math.random) {
    this.rnd = rnd;
    /** 参考高度基础风速 m/s */
    this.base = 6;
    /** 定风模式（验证物理时用，关掉一切阵风） */
    this.steady = false;
    /** 当前参考高度水平风速 */
    this.speed = 6;
    /** 当前垂直扰动 */
    this.vy = 0;
    this.t = 0;
    this.ph = [];
    this.gustValue = 0;
    this.gustTarget = 0;
    this.gustTimer = 0;
    this.nextGustIn = 6;
    for (let i = 0; i < 5; i++) this.ph.push(rnd() * Math.PI * 2);
  }
  update(dt) {
    this.t += dt;
    if (this.steady) {
      this.speed = this.base;
      this.vy = 0;
      return;
    }
    const t = this.t, p = this.ph;
    const g = 0.22 * Math.sin(0.13 * t + p[0]) + 0.15 * Math.sin(0.47 * t + p[1]) + 0.08 * Math.sin(1.9 * t + p[2]);
    if (this.gustTimer > 0) {
      this.gustTimer -= dt;
      this.gustValue += (this.gustTarget - this.gustValue) * Math.min(1, dt * 1.6);
    } else {
      this.gustValue += (0 - this.gustValue) * Math.min(1, dt * 0.7);
      this.nextGustIn -= dt;
      if (this.nextGustIn <= 0) {
        this.gustTarget = 0.25 + this.rnd() * 0.4;
        this.gustTimer = 1.5 + this.rnd() * 3;
        this.nextGustIn = 6 + this.rnd() * 14;
      }
    }
    this.speed = Math.max(2.2, this.base * (1 + g + this.gustValue));
    this.vy = this.base * 0.12 * Math.sin(0.9 * t + p[3]) * (0.5 + this.gustValue);
  }
  /** 高度 y 处的风速（含边界层：低空风弱且乱） */
  at(y) {
    const f = Math.min(1.12, Math.max(0.4, Math.pow(Math.max(y, 0.5) / 8, 0.15)));
    return { x: this.speed * f, y: this.vy * f };
  }
};

// src/util.ts
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = a + 1831565813 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/physics.ts
var RHO = 1.225;
var G = 9.81;
var N = 300;
var CD_LINE = 0.9;
var ITERS = 12;
var R_CONTACT = 0.12;
var WEAR_K = 0.06;
var FRICTION = 0.12;
var SLIDE_MIN = 0.25;
var WALK_SPEED = 3;
var REEL_IN = 6;
var REEL_OUT = 11;
var MIN_LEN = 35;
var MAX_LEN = 160;
var Player = class {
  constructor(spec, lspec, ax) {
    this.spec = spec;
    this.lspec = lspec;
    this.anchorY = 0;
    // 线节点 0..N-1，索引 N 为风筝（Verlet：x/y 当前，ox/oy 上一步）
    this.x = new Float64Array(N + 1);
    this.y = new Float64Array(N + 1);
    this.ox = new Float64Array(N + 1);
    this.oy = new Float64Array(N + 1);
    /** 每个线节点的剩余耐久，降到 0 即断 */
    this.integrity = new Float64Array(N);
    this.len = 60;
    this.broken = false;
    this.breakAt = -1;
    this.landed = false;
    this.input = { reel: 0, walk: 0 };
    this.anchorX = ax;
    this.reset();
  }
  get kiteX() {
    return this.x[N];
  }
  get kiteY() {
    return this.y[N];
  }
  get segLen() {
    return this.len / N;
  }
  reset(angleDeg = 62) {
    const a = angleDeg * Math.PI / 180;
    for (let i = 0; i <= N; i++) {
      const d = this.segLen * i;
      this.x[i] = this.anchorX + Math.cos(a) * d;
      this.y[i] = Math.sin(a) * d;
      this.ox[i] = this.x[i];
      this.oy[i] = this.y[i];
    }
    this.integrity.fill(this.lspec.strength);
    this.broken = false;
    this.breakAt = -1;
    this.landed = false;
  }
  /** 锚点到风筝的直线放飞角（度） */
  flightAngle() {
    return Math.atan2(this.kiteY - this.anchorY, this.kiteX - this.anchorX) * 180 / Math.PI;
  }
};
function segSegClosest(a1x, a1y, a2x, a2y, b1x, b1y, b2x, b2y) {
  const d1x = a2x - a1x, d1y = a2y - a1y;
  const d2x = b2x - b1x, d2y = b2y - b1y;
  const rx = a1x - b1x, ry = a1y - b1y;
  const a = d1x * d1x + d1y * d1y;
  const e = d2x * d2x + d2y * d2y;
  const f = d2x * rx + d2y * ry;
  const c = d1x * rx + d1y * ry;
  const b = d1x * d2x + d1y * d2y;
  const den = a * e - b * b;
  let s = den > 1e-12 ? (b * f - c * e) / den : 0;
  s = clamp(s, 0, 1);
  let t = e > 1e-12 ? (b * s + f) / e : 0;
  if (t < 0) {
    t = 0;
    s = a > 1e-12 ? -c / a : 0;
  } else if (t > 1) {
    t = 1;
    s = a > 1e-12 ? (b - c) / a : 0;
  }
  s = clamp(s, 0, 1);
  const px = a1x + d1x * s - (b1x + d2x * t);
  const py = a1y + d1y * s - (b1y + d2y * t);
  return [s, t, px * px + py * py];
}
var World = class {
  constructor(mode, rnd) {
    this.mode = mode;
    this.players = [];
    this.t = 0;
    this.contacts = [];
    this.phase = "fight";
    this.loser = -1;
    this.endTimer = 0;
    this.fx = new Float64Array(N + 1);
    this.fy = new Float64Array(N + 1);
    this.grid = /* @__PURE__ */ new Map();
    this.stamp = new Int32Array(N);
    this.stampId = 0;
    this.wind = new Wind(rnd);
  }
  addPlayer(p) {
    this.players.push(p);
  }
  step(dt) {
    this.t += dt;
    this.wind.update(dt);
    for (const p of this.players) {
      if (!p.broken) {
        p.anchorX = clamp(p.anchorX + p.input.walk * WALK_SPEED * dt, -90, 90);
        const r = p.input.reel;
        if (r > 0) p.len = Math.max(MIN_LEN, p.len - r * REEL_IN * dt);
        else if (r < 0) p.len = Math.min(MAX_LEN, p.len + -r * REEL_OUT * dt);
      }
      this.integrate(p, dt);
      if (!p.broken) this.tether(p);
      this.solveChain(p);
    }
    this.contacts.length = 0;
    if (this.players.length === 2 && !this.players[0].broken && !this.players[1].broken) {
      this.collideLines(dt);
    }
    if (this.phase === "fight") {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (p.broken) continue;
        for (let k = 0; k < N; k++) {
          if (p.integrity[k] <= 0) {
            p.broken = true;
            p.breakAt = Math.max(1, k);
            this.phase = "broken";
            this.loser = i;
            break;
          }
        }
      }
    } else if (this.phase === "broken") {
      this.endTimer += dt;
      if (this.endTimer > 3.5) this.phase = "done";
    }
  }
  integrate(p, dt) {
    const { x, y, ox, oy } = p;
    const seg = p.segLen;
    const nodeMass = p.lspec.density * seg;
    const fx = this.fx, fy = this.fy;
    fx.fill(0);
    fy.fill(0);
    const dragArea = p.lspec.diameter * seg;
    for (let i = 0; i < N; i++) {
      if (p.broken && i === p.breakAt - 1) continue;
      const mx = (x[i] + x[i + 1]) * 0.5;
      const my = (y[i] + y[i + 1]) * 0.5;
      const mvx = (x[i] - ox[i] + x[i + 1] - ox[i + 1]) * 0.5 / dt;
      const mvy = (y[i] - oy[i] + y[i + 1] - oy[i + 1]) * 0.5 / dt;
      const w2 = this.wind.at(my);
      const wx2 = w2.x - mvx, wy2 = w2.y - mvy;
      const sp = Math.hypot(wx2, wy2);
      if (sp < 0.01) continue;
      const f = 0.5 * RHO * sp * sp * dragArea * CD_LINE;
      const fxv = f * wx2 / sp, fyv = f * wy2 / sp;
      fx[i] += fxv * 0.5;
      fy[i] += fyv * 0.5;
      fx[i + 1] += fxv * 0.5;
      fy[i + 1] += fyv * 0.5;
    }
    for (let i = 1; i < N; i++) fy[i] -= nodeMass * G;
    const kvx = (x[N] - ox[N]) / dt, kvy = (y[N] - oy[N]) / dt;
    const w = this.wind.at(y[N]);
    const wx = w.x - kvx, wy = w.y - kvy;
    const spd = Math.hypot(wx, wy);
    const m = p.spec.mass;
    let kfx = 0, kfy = -m * G;
    if (spd > 0.01) {
      const ux = wx / spd, uy = wy / spd;
      const q = 0.5 * RHO * spd * spd * p.spec.area;
      const cl = p.broken ? 0 : p.spec.cl;
      const cd = p.broken ? 1.25 : p.spec.cd;
      let lx = -uy, ly = ux;
      if (ly < 0) {
        lx = -lx;
        ly = -ly;
      }
      kfx += lx * q * cl + ux * q * cd;
      kfy += ly * q * cl + uy * q * cd;
    }
    const damp = (p.broken ? 1 : 0.35) * m;
    kfx -= kvx * damp;
    kfy -= kvy * damp;
    fx[N] += kfx;
    fy[N] += kfy;
    const dt2 = dt * dt;
    const start = p.broken ? 0 : 1;
    for (let i = start; i <= N; i++) {
      const mass = i === N ? m : nodeMass;
      const nx = x[i] + (x[i] - ox[i]) * 0.999 + fx[i] / mass * dt2;
      const ny = y[i] + (y[i] - oy[i]) * 0.999 + fy[i] / mass * dt2;
      ox[i] = x[i];
      oy[i] = y[i];
      x[i] = nx;
      y[i] = ny;
    }
    if (!p.broken) {
      x[0] = p.anchorX;
      y[0] = p.anchorY;
      ox[0] = x[0];
      oy[0] = y[0];
    }
    for (let i = 0; i < N; i++) {
      if (y[i] < 0.03) {
        y[i] = 0.03;
        oy[i] = y[i];
      }
    }
    if (y[N] <= 0.4) {
      y[N] = 0.4;
      if (oy[N] < y[N]) oy[N] = y[N];
      if (p.broken) {
        p.landed = true;
        ox[N] = x[N] - this.wind.at(1).x * dt * 0.2;
      } else if (p.input.reel > 0.5) {
        oy[N] = y[N] + 5 * dt;
      }
    }
  }
  /** 系留约束：风筝不得离锚点超过线长（绷紧时这就是线的张力） */
  tether(p) {
    const dx = p.x[N] - p.anchorX;
    const dy = p.y[N] - p.anchorY;
    const dist = Math.hypot(dx, dy);
    if (dist > p.len && dist > 1e-6) {
      const k = p.len / dist;
      p.x[N] = p.anchorX + dx * k;
      p.y[N] = p.anchorY + dy * k;
    }
  }
  /** 链约束：两端（锚点、风筝）固定，中间节点按距离约束收敛出垂度 */
  solveChain(p) {
    const { x, y } = p;
    const seg = p.segLen;
    for (let it = 0; it < ITERS; it++) {
      for (let d = 0; d < 2; d++) {
        const fwd = d === 0;
        for (let s = 0; s < N; s++) {
          const i = fwd ? s : N - 1 - s;
          if (p.broken && i === p.breakAt - 1) continue;
          const j = i + 1;
          const pinI = !p.broken ? i === 0 : false;
          const pinJ = !p.broken && j === N;
          const dx = x[j] - x[i], dy = y[j] - y[i];
          const dist = Math.hypot(dx, dy) || 1e-9;
          const diff = (dist - seg) / dist;
          if (pinI && pinJ) continue;
          if (pinI) {
            x[j] -= dx * diff;
            y[j] -= dy * diff;
          } else if (pinJ) {
            x[i] += dx * diff;
            y[i] += dy * diff;
          } else {
            const half = diff * 0.5;
            x[i] += dx * half;
            y[i] += dy * half;
            x[j] -= dx * half;
            y[j] -= dy * half;
          }
        }
      }
    }
    if (!p.broken) {
      x[0] = p.anchorX;
      y[0] = p.anchorY;
    }
  }
  /** 两线交叉判定 + 磨损：A 线段入均匀网格，B 线段查询 */
  collideLines(dt) {
    const A = this.players[0], B = this.players[1];
    const cell = 2;
    const grid = this.grid;
    for (const arr of grid.values()) arr.length = 0;
    for (let i = 0; i < N; i++) {
      const x0 = A.x[i], y0 = A.y[i], x1 = A.x[i + 1], y1 = A.y[i + 1];
      const minx = Math.floor(Math.min(x0, x1) / cell);
      const maxx = Math.floor(Math.max(x0, x1) / cell);
      const miny = Math.floor(Math.min(y0, y1) / cell);
      const maxy = Math.floor(Math.max(y0, y1) / cell);
      for (let cx = minx; cx <= maxx; cx++) {
        for (let cy = miny; cy <= maxy; cy++) {
          const key = cx * 1e5 + cy;
          let arr = grid.get(key);
          if (!arr) {
            arr = [];
            grid.set(key, arr);
          }
          arr.push(i);
        }
      }
    }
    this.stampId++;
    for (let j = 0; j < N; j++) {
      const x0 = B.x[j], y0 = B.y[j], x1 = B.x[j + 1], y1 = B.y[j + 1];
      const minx = Math.floor(Math.min(x0, x1) / cell);
      const maxx = Math.floor(Math.max(x0, x1) / cell);
      const miny = Math.floor(Math.min(y0, y1) / cell);
      const maxy = Math.floor(Math.max(y0, y1) / cell);
      for (let cx = minx; cx <= maxx; cx++) {
        for (let cy = miny; cy <= maxy; cy++) {
          const arr = grid.get(cx * 1e5 + cy);
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const i = arr[k];
            if (this.stamp[i] === this.stampId) continue;
            this.stamp[i] = this.stampId;
            this.contactPair(A, i, B, j, dt);
          }
        }
      }
    }
  }
  /** 节点是否可被动（锚点与风筝由别处管） */
  movable(p, idx) {
    if (idx === N) return p.broken;
    if (idx === 0) return p.broken;
    return true;
  }
  contactPair(A, i, B, j, dt) {
    const [s, t, d2] = segSegClosest(
      A.x[i],
      A.y[i],
      A.x[i + 1],
      A.y[i + 1],
      B.x[j],
      B.y[j],
      B.x[j + 1],
      B.y[j + 1]
    );
    if (d2 > R_CONTACT * R_CONTACT) return;
    const d = Math.sqrt(d2);
    const pax = A.x[i] + (A.x[i + 1] - A.x[i]) * s;
    const pay = A.y[i] + (A.y[i + 1] - A.y[i]) * s;
    const pbx = B.x[j] + (B.x[j + 1] - B.x[j]) * t;
    const pby = B.y[j] + (B.y[j + 1] - B.y[j]) * t;
    const vax = (A.x[i] - A.ox[i]) * (1 - s) + (A.x[i + 1] - A.ox[i + 1]) * s;
    const vay = (A.y[i] - A.oy[i]) * (1 - s) + (A.y[i + 1] - A.oy[i + 1]) * s;
    const vbx = (B.x[j] - B.ox[j]) * (1 - t) + (B.x[j + 1] - B.ox[j + 1]) * t;
    const vby = (B.y[j] - B.oy[j]) * (1 - t) + (B.y[j + 1] - B.oy[j + 1]) * t;
    const rvx = vax - vbx, rvy = vay - vby;
    let nx = pbx - pax, ny = pby - pay;
    if (d > 1e-5) {
      nx /= d;
      ny /= d;
    } else {
      const tx = B.x[j + 1] - B.x[j], ty = B.y[j + 1] - B.y[j];
      const tl = Math.hypot(tx, ty) || 1;
      nx = -ty / tl;
      ny = tx / tl;
    }
    const vn = rvx * nx + rvy * ny;
    const svx = rvx - vn * nx, svy = rvy - vn * ny;
    const slide = Math.hypot(svx, svy) / dt;
    if (slide > SLIDE_MIN) {
      const ia = s < 0.5 ? i : i + 1;
      const ib = t < 0.5 ? j : j + 1;
      if (ia < N) A.integrity[ia] -= WEAR_K * B.lspec.wearFactor * slide * dt;
      if (ib < N) B.integrity[ib] -= WEAR_K * A.lspec.wearFactor * slide * dt;
    }
    if (d > 1e-4) {
      const push = (R_CONTACT - d) * 0.5;
      const wA = this.movable(A, i) ? 1 : 0;
      const wB = this.movable(B, j) ? 1 : 0;
      const wSum = wA + wB || 1;
      const pA = push * 2 * wA / wSum * 0.5;
      const pB = push * 2 * wB / wSum * 0.5;
      A.x[i] -= nx * pA * (1 - s);
      A.y[i] -= ny * pA * (1 - s);
      if (i + 1 < N || A.broken) {
        A.x[i + 1] -= nx * pA * s;
        A.y[i + 1] -= ny * pA * s;
      }
      B.x[j] += nx * pB * (1 - t);
      B.y[j] += ny * pB * (1 - t);
      if (j + 1 < N || B.broken) {
        B.x[j + 1] += nx * pB * s;
        B.y[j + 1] += ny * pB * t;
      }
    }
    const ia2 = s < 0.5 ? i : i + 1;
    const ib2 = t < 0.5 ? j : j + 1;
    const fr = FRICTION * 0.5;
    if (this.movable(A, ia2)) {
      A.ox[ia2] += svx * fr;
      A.oy[ia2] += svy * fr;
    }
    if (this.movable(B, ib2)) {
      B.ox[ib2] -= svx * fr;
      B.oy[ib2] -= svy * fr;
    }
    this.contacts.push({ x: (pax + pbx) / 2, y: (pay + pby) / 2, slide });
  }
};

// src/kites.ts
var KITES = [
  {
    id: "shayan",
    name: "\u6C99\u71D5",
    origin: "\u5317\u4EAC",
    desc: "\u5317\u4EAC\u786C\u7FC5\u6C99\u71D5\uFF0C\u5347\u529B\u8DB3\u3001\u6027\u5B50\u7A33\uFF0C\u6B63\u7ECF\u7684\u770B\u5BB6\u98CE\u7B5D\u3002",
    area: 0.45,
    mass: 0.15,
    cl: 0.92,
    cd: 0.19,
    shape: "shayan",
    color: "#2c6fbb",
    accent: "#e8442e"
  },
  {
    id: "yingchi",
    name: "\u786C\u7FC5\u4ED5\u5973",
    origin: "\u6F4D\u574A",
    desc: "\u6F4D\u574A\u786C\u7FC5\uFF0C\u67B6\u5B50\u786C\u6717\uFF0C\u98CE\u5927\u624D\u653E\u5F97\u5F00\uFF0C\u538B\u5F97\u4F4F\u9635\u811A\u3002",
    area: 0.62,
    mass: 0.24,
    cl: 0.86,
    cd: 0.21,
    shape: "yingchi",
    color: "#c23a8e",
    accent: "#f5d020"
  },
  {
    id: "banyao",
    name: "\u677F\u9E5E",
    origin: "\u5357\u901A",
    desc: "\u5357\u901A\u677F\u9E5E\uFF0C\u54E8\u53E3\u6210\u98CE\u3002\u5757\u5934\u5927\u3001\u62C9\u529B\u6A2A\uFF0C\u6162\u4F46\u662F\u6C89\u3002",
    area: 0.95,
    mass: 0.28,
    cl: 0.76,
    cd: 0.26,
    shape: "banyao",
    color: "#d9822b",
    accent: "#203a8f"
  },
  {
    id: "hudie",
    name: "\u8F6F\u7FC5\u8774\u8776",
    origin: "\u5929\u6D25",
    desc: "\u5929\u6D25\u8F6F\u7FC5\uFF0C\u7FC5\u5B50\u6D3B\u6CDB\uFF0C\u8EAB\u8F7B\u5982\u53F6\uFF0C\u98CE\u4E00\u53D8\u5B83\u5148\u77E5\u9053\u3002",
    area: 0.4,
    mass: 0.12,
    cl: 0.98,
    cd: 0.23,
    shape: "hudie",
    color: "#7a3fc9",
    accent: "#ffd166"
  },
  {
    id: "douzheng",
    name: "\u6253\u6597\u98CE\u7B5D",
    origin: "\u9633\u6C5F",
    desc: "\u5E7F\u4E1C\u6253\u6597\u7B5D\uFF0C\u5C0F\u5FEB\u7075\uFF0C\u4E13\u4E3A\u5272\u7EBF\u800C\u751F\uFF0C\u914D\u73BB\u7483\u7EBF\u6700\u51F6\u3002",
    area: 0.3,
    mass: 0.09,
    cl: 0.7,
    cd: 0.15,
    shape: "dou",
    color: "#e8e3d8",
    accent: "#c0392b"
  }
];
var LINES = [
  {
    id: "cotton",
    name: "\u68C9\u7EBF",
    glass: 0,
    wearFactor: 0.5,
    strength: 1.7,
    density: 2e-4,
    diameter: 22e-5,
    color: "#e8e0c8",
    desc: "\u7ED3\u5B9E\u8010\u78E8\uFF0C\u5C31\u662F\u54AC\u4E0D\u52A8\u522B\u4EBA\u7684\u7EBF\u3002"
  },
  {
    id: "glass1",
    name: "\u4E00\u7C89\u73BB\u7483\u7EBF",
    glass: 1,
    wearFactor: 1,
    strength: 1.25,
    density: 17e-5,
    diameter: 19e-5,
    color: "#d8e6c8",
    desc: "\u8584\u8584\u4E00\u5C42\u73BB\u7483\u7C89\uFF0C\u653B\u5B88\u90FD\u6CBE\u4E00\u70B9\u3002"
  },
  {
    id: "glass2",
    name: "\u4E8C\u7C89\u73BB\u7483\u7EBF",
    glass: 2,
    wearFactor: 1.6,
    strength: 0.95,
    density: 16e-5,
    diameter: 18e-5,
    color: "#c8d8e8",
    desc: "\u8001\u73A9\u5BB6\u7684\u6807\u914D\uFF0C\u5272\u5F97\u52A8\u4E5F\u625B\u5F97\u4F4F\u3002"
  },
  {
    id: "glass3",
    name: "\u4E09\u7C89\u73BB\u7483\u7EBF",
    glass: 3,
    wearFactor: 2.4,
    strength: 0.7,
    density: 15e-5,
    diameter: 17e-5,
    color: "#e8c8c8",
    desc: "\u6EE1\u53E3\u73BB\u7483\u78B4\uFF0C\u5272\u4EBA\u5FEB\uFF0C\u81EA\u5DF1\u4E5F\u8106\u3002"
  }
];
function theoryAngle(spec) {
  return Math.atan(spec.cl / spec.cd) * 180 / Math.PI;
}

// src/ai.ts
var AIController = class {
  constructor(skill = 1) {
    this.skill = skill;
    this.mode = "approach";
    this.sawT = 0;
    this.thinkT = 0;
    this.reelCmd = 0;
    this.walkCmd = 0;
  }
  update(w, me, foe, dt) {
    const inp = me.input;
    if (me.broken || w.phase !== "fight") {
      inp.reel = 0;
      inp.walk = 0;
      return;
    }
    if (w.contacts.length > 0) {
      this.mode = "saw";
      this.sawT = 0.8 + Math.random() * 0.6;
    }
    if (this.mode === "saw") {
      this.sawT -= dt;
      const ph = this.sawT * (5 + this.skill * 2);
      inp.reel = Math.sin(ph) > 0.2 ? -1 : 0.8;
      inp.walk = 0;
      if (this.sawT <= 0) this.mode = "approach";
      return;
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 / this.skill;
      const tx = foe.kiteX + 3;
      const ty = foe.kiteY + 2.5;
      const offX = me.kiteX - me.anchorX;
      const dw = tx - offX - me.anchorX;
      this.walkCmd = Math.abs(dw) > 1.5 ? Math.sign(dw) * 0.9 : 0;
      const dy = ty - me.kiteY;
      this.reelCmd = dy > 2 ? 0.85 : dy < -4 ? -0.6 : 0;
    }
    inp.walk = this.walkCmd;
    inp.reel = this.reelCmd;
  }
};

// test/verify.ts
var DT = 1 / 120;
var failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  if (!ok) failures++;
}
console.log("== \u7A33\u5B9A\u98CE\u901F\u4E0B\u7684\u653E\u98DE\u89D2 vs \u7406\u8BBA\u503C ==");
var stdLine = LINES[2];
for (const windSpeed of [6, 8]) {
  for (const spec of KITES) {
    const w = new World("test", mulberry32(42));
    w.wind.steady = true;
    w.wind.base = windSpeed;
    w.wind.update(DT);
    const p = new Player(spec, stdLine, 0);
    p.len = 100;
    p.reset(theoryAngle(spec));
    w.addPlayer(p);
    for (let s = 0; s < 120 * 60; s++) w.step(DT);
    let sum = 0, cnt = 0;
    for (let s = 0; s < 120 * 30; s++) {
      w.step(DT);
      sum += p.flightAngle();
      cnt++;
    }
    const avg = sum / cnt;
    const theory = theoryAngle(spec);
    const dev = avg - theory;
    check(
      `${spec.name}@${windSpeed}m/s`,
      Math.abs(dev) <= 3,
      `\u5B9E\u6D4B ${avg.toFixed(2)}\xB0  \u7406\u8BBA ${theory.toFixed(2)}\xB0  \u504F\u5DEE ${dev >= 0 ? "+" : ""}${dev.toFixed(2)}\xB0`
    );
  }
}
console.log("\n== \u6027\u80FD\uFF1A\u4E24\u6761 300 \u8282\u70B9\u7684\u7EBF\uFF0C\u4EA4\u53C9\u5224\u5B9A+\u78E8\u635F\uFF0C120Hz ==");
{
  const w = new World("battle", mulberry32(7));
  w.wind.base = 7;
  const p1 = new Player(KITES[0], LINES[2], 0);
  p1.len = 120;
  w.addPlayer(p1);
  const p2 = new Player(KITES[4], LINES[2], 15);
  p2.len = 120;
  w.addPlayer(p2);
  let contactSteps = 0;
  const steps = 1200;
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    p2.input.walk = Math.sin(w.t * 1.2) > 0 ? -1 : 1;
    p2.input.reel = Math.sin(w.t * 5) > 0 ? -1 : 0.8;
    p1.input.reel = Math.cos(w.t * 4) > 0 ? 0.8 : -0.8;
    w.step(DT);
    if (w.contacts.length > 0) contactSteps++;
    if (w.phase !== "fight") break;
  }
  const t1 = performance.now();
  const msPerStep = (t1 - t0) / steps;
  console.log(`  \u5E73\u5747\u5355\u6B65 ${msPerStep.toFixed(3)} ms\uFF08120Hz \u9884\u7B97 8.33ms\uFF09\uFF0C\u6709\u63A5\u89E6\u7684\u6B65\u6570 ${contactSteps}/${steps}`);
  check("120Hz \u4E0D\u5361\u987F", msPerStep < 3, `\u5355\u6B65 ${msPerStep.toFixed(3)}ms < 3ms`);
  check("\u4EA4\u53C9\u5224\u5B9A\u786E\u5B9E\u89E6\u53D1", contactSteps > 0, `${contactSteps} \u6B65\u6709\u63A5\u89E6`);
  check("\u7EBF\u88AB\u78E8\u65AD", w.phase !== "fight", `\u7B2C ${w.t.toFixed(1)}s \u65AD\u7EBF\uFF0C\u8D25\u8005=${w.loser}`);
}
console.log("\n== \u6536\u653E\u7EBF\u624B\u611F\u65B9\u5411 ==");
{
  const w = new World("test", mulberry32(3));
  w.wind.steady = true;
  w.wind.base = 7;
  w.wind.update(DT);
  const p = new Player(KITES[0], stdLine, 0);
  p.len = 100;
  p.reset(theoryAngle(KITES[0]));
  w.addPlayer(p);
  for (let s = 0; s < 120 * 30; s++) w.step(DT);
  const a0 = p.flightAngle();
  p.input.reel = 1;
  let aMax = 0;
  for (let s = 0; s < 120 * 3; s++) {
    w.step(DT);
    aMax = Math.max(aMax, p.flightAngle());
  }
  p.input.reel = 0;
  for (let s = 0; s < 120 * 10; s++) w.step(DT);
  p.input.reel = -1;
  let aMin = 999;
  for (let s = 0; s < 120 * 3; s++) {
    w.step(DT);
    aMin = Math.min(aMin, p.flightAngle());
  }
  p.input.reel = 0;
  check("\u6536\u7EBF\u722C\u5347", aMax > a0 + 1, `\u7A33\u6001 ${a0.toFixed(1)}\xB0\uFF0C\u6536\u7EBF\u51B2\u5230 ${aMax.toFixed(1)}\xB0`);
  check("\u653E\u7EBF\u4E0B\u6C89", aMin < a0 - 1, `\u7A33\u6001 ${a0.toFixed(1)}\xB0\uFF0C\u653E\u7EBF\u843D\u5230 ${aMin.toFixed(1)}\xB0`);
}
console.log("\n== \u5B8C\u6574\u5BF9\u6218\u5192\u70DF ==");
{
  const w = new World("battle", mulberry32(11));
  w.wind.base = 6.5;
  const p1 = new Player(KITES[0], LINES[2], -12);
  p1.len = 70;
  p1.reset(theoryAngle(KITES[0]));
  const p2 = new Player(KITES[4], LINES[2], 12);
  p2.len = 70;
  p2.reset(theoryAngle(KITES[4]));
  w.addPlayer(p1);
  w.addPlayer(p2);
  const ai1 = new AIController(1);
  const ai2 = new AIController(1);
  for (let s = 0; s < 120 * 180 && w.phase !== "done"; s++) {
    ai1.update(w, p1, p2, DT);
    ai2.update(w, p2, p1, DT);
    w.step(DT);
  }
  let nan = false;
  for (const arr of [p1.x, p1.y, p2.x, p2.y]) {
    for (const v of arr) if (!Number.isFinite(v)) nan = true;
  }
  check("\u6570\u503C\u4E0D\u53D1\u6563", !nan, nan ? "\u51FA\u73B0 NaN/Inf" : "\u5750\u6807\u5168\u90E8\u6709\u9650");
  check("\u5BF9\u5C40\u80FD\u5206\u51FA\u80DC\u8D1F", w.phase === "done", `\u7ED3\u675F\u4E8E ${w.t.toFixed(1)}s\uFF0C\u8D25\u8005=${w.loser}`);
}
console.log(failures === 0 ? "\n\u5168\u90E8\u901A\u8FC7 \u2714" : `
${failures} \u9879\u672A\u901A\u8FC7 \u2717`);
process.exit(failures === 0 ? 0 : 1);
