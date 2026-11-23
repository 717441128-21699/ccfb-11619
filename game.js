"use strict";
(() => {
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
  var lerp = (a, b, t) => a + (b - a) * t;

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

  // src/render.ts
  var KITE_VIS = 2.4;
  var Renderer = class {
    constructor(cv2) {
      this.cv = cv2;
      this.cx = 30;
      this.cy = 45;
      this.scale = 8;
      this.particles = [];
      this.clouds = [];
      this.W = 0;
      this.H = 0;
      this.ctx = cv2.getContext("2d");
      this.resize();
      for (let i = 0; i < 70; i++) {
        this.particles.push({ x: Math.random() * 200 - 40, y: Math.random() * 120 });
      }
      for (let i = 0; i < 6; i++) {
        this.clouds.push({ x: Math.random() * 250 - 50, y: 40 + Math.random() * 70, s: 6 + Math.random() * 10 });
      }
    }
    resize() {
      this.W = this.cv.width = this.cv.clientWidth * devicePixelRatio;
      this.H = this.cv.height = this.cv.clientHeight * devicePixelRatio;
    }
    sx(x) {
      return this.W / 2 + (x - this.cx) * this.scale;
    }
    sy(y) {
      return this.H / 2 - (y - this.cy) * this.scale;
    }
    updateCamera(world2, dt) {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const p of world2.players) {
        minx = Math.min(minx, p.anchorX, p.kiteX);
        maxx = Math.max(maxx, p.anchorX, p.kiteX);
        maxy = Math.max(maxy, p.kiteY);
      }
      miny = 0;
      const bw = Math.max(30, maxx - minx + 24);
      const bh = Math.max(30, maxy - miny + 18);
      const ts = clamp(Math.min(this.W / bw, this.H / bh), 2.5 * devicePixelRatio, 14 * devicePixelRatio);
      const tx = (minx + maxx) / 2;
      const ty = (miny + maxy) / 2 + 4;
      const k = Math.min(1, dt * 2.5);
      this.scale = lerp(this.scale, ts, k);
      this.cx = lerp(this.cx, tx, k);
      this.cy = lerp(this.cy, ty, k);
    }
    render(world2, hud, dt, tGlobal2) {
      const { ctx } = this;
      const windSpeed = world2 ? world2.wind.speed : 5;
      const windVy = world2 ? world2.wind.vy : 0;
      const grad = ctx.createLinearGradient(0, 0, 0, this.H);
      grad.addColorStop(0, "#7db8e8");
      grad.addColorStop(0.6, "#a8d0ee");
      grad.addColorStop(1, "#d8ecf7");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      for (const c of this.clouds) {
        c.x += windSpeed * dt * 0.9;
        if (this.sx(c.x) - c.s * this.scale > this.W) c.x -= this.W / this.scale + c.s * 4;
        const px = this.sx(c.x), py = this.sy(c.y);
        ctx.beginPath();
        ctx.ellipse(px, py, c.s * this.scale * 0.9, c.s * this.scale * 0.32, 0, 0, Math.PI * 2);
        ctx.ellipse(px + c.s * this.scale * 0.5, py + c.s * this.scale * 0.1, c.s * this.scale * 0.6, c.s * this.scale * 0.25, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1 * devicePixelRatio;
      for (const pt of this.particles) {
        pt.x += windSpeed * dt;
        pt.y += windVy * dt;
        if (this.sx(pt.x) > this.W + 20) {
          pt.x -= this.W / this.scale + 40;
          pt.y = Math.random() * 120;
        }
        const px = this.sx(pt.x), py = this.sy(pt.y);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px - windSpeed * this.scale * 0.12, py + windVy * this.scale * 0.12);
        ctx.stroke();
      }
      const gy = this.sy(0);
      const ggrad = ctx.createLinearGradient(0, gy, 0, this.H);
      ggrad.addColorStop(0, "#7aa05c");
      ggrad.addColorStop(1, "#5c7f44");
      ctx.fillStyle = ggrad;
      ctx.fillRect(0, gy, this.W, this.H - gy);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `${10 * devicePixelRatio}px sans-serif`;
      ctx.textAlign = "center";
      const step2 = 20;
      const x0 = Math.floor((this.cx - this.W / 2 / this.scale) / step2) * step2;
      for (let x = x0; this.sx(x) < this.W + 20; x += step2) {
        ctx.fillRect(this.sx(x), gy, 1, 5 * devicePixelRatio);
        ctx.fillText(`${x}m`, this.sx(x), gy + 16 * devicePixelRatio);
      }
      if (world2) {
        this.updateCamera(world2, dt);
        for (let i = 0; i < world2.players.length; i++) {
          this.drawPlayer(world2.players[i], i === 0 ? "#2266cc" : "#cc3322", tGlobal2);
        }
        for (const p of world2.players) this.drawLine(p);
        for (const p of world2.players) this.drawKite(p, tGlobal2, world2.t);
        this.drawContacts(world2);
      }
      if (hud && world2) this.drawHud(world2, hud);
    }
    drawPlayer(p, color, t) {
      const { ctx } = this;
      const px = this.sx(p.anchorX), py = this.sy(0);
      const s = this.scale;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath();
      ctx.arc(px, py - 1.55 * s, 0.28 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px, py - 1.27 * s);
      ctx.lineTo(px, py - 0.5 * s);
      ctx.moveTo(px, py - 0.5 * s);
      ctx.lineTo(px - 0.3 * s, py);
      ctx.moveTo(px, py - 0.5 * s);
      ctx.lineTo(px + 0.3 * s, py);
      const reel = p.input.reel;
      const ay = py - 1 * s + Math.sin(t * 10) * reel * 0.1 * s;
      ctx.moveTo(px, py - 1.1 * s);
      ctx.lineTo(px + 0.35 * s, ay);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(px + 0.35 * s, ay, 0.12 * s, 0, Math.PI * 2);
      ctx.stroke();
    }
    drawLine(p) {
      const { ctx } = this;
      ctx.lineWidth = Math.max(1, 1.3 * devicePixelRatio);
      const end = p.broken ? p.breakAt : N;
      for (let i = 0; i < N; i++) {
        if (p.broken && i === p.breakAt - 1) continue;
        const integ = p.integrity[Math.min(i, N - 1)] / p.lspec.strength;
        ctx.strokeStyle = this.integrityColor(integ, p.lspec.color);
        ctx.beginPath();
        ctx.moveTo(this.sx(p.x[i]), this.sy(p.y[i]));
        ctx.lineTo(this.sx(p.x[i + 1]), this.sy(p.y[i + 1]));
        ctx.stroke();
      }
      void end;
    }
    integrityColor(f, base) {
      const c = clamp(f, 0, 1);
      if (c > 0.6) return base;
      if (c > 0.3) return "#e8b83a";
      return "#e83a2e";
    }
    drawKite(p, tGlobal2, tWorld) {
      const { ctx } = this;
      const kx = this.sx(p.kiteX), ky = this.sy(p.kiteY);
      let ang;
      if (p.broken) {
        ang = tWorld * 3.5;
      } else {
        const i = N - 1;
        ang = Math.atan2(p.y[N] - p.y[i], p.x[N] - p.x[i]) - Math.PI / 2;
        ang += Math.sin(tGlobal2 * 7 + p.anchorX) * 0.05;
      }
      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(ang);
      const u = this.scale * KITE_VIS * Math.sqrt(p.spec.area);
      this.drawShape(p.spec, u);
      ctx.restore();
    }
    drawShape(spec, u) {
      const { ctx } = this;
      ctx.fillStyle = spec.color;
      ctx.strokeStyle = spec.accent;
      ctx.lineWidth = Math.max(1, u * 0.06);
      ctx.beginPath();
      switch (spec.shape) {
        case "dou":
          ctx.moveTo(0, u * 0.9);
          ctx.lineTo(u * 0.62, 0);
          ctx.lineTo(0, -u * 0.9);
          ctx.lineTo(-u * 0.62, 0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, u * 0.9);
          ctx.lineTo(0, -u * 0.9);
          ctx.moveTo(-u * 0.62, 0);
          ctx.lineTo(u * 0.62, 0);
          ctx.stroke();
          break;
        case "banyao":
          for (let i = 0; i < 6; i++) {
            const a = i / 6 * Math.PI * 2 - Math.PI / 2;
            const px = Math.cos(a) * u * 0.85, py = Math.sin(a) * u * 0.85;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = spec.accent;
          for (const [cx, cy, r] of [[0, 0, 0.22], [-0.35, 0.25, 0.13], [0.35, 0.25, 0.13], [0, -0.4, 0.13]]) {
            ctx.beginPath();
            ctx.arc(cx * u, cy * u, r * u, 0, Math.PI * 2);
            ctx.fill();
          }
          break;
        case "hudie":
          ctx.ellipse(-u * 0.42, u * 0.25, u * 0.42, u * 0.34, -0.4, 0, Math.PI * 2);
          ctx.ellipse(u * 0.42, u * 0.25, u * 0.42, u * 0.34, 0.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(-u * 0.3, -u * 0.35, u * 0.28, u * 0.24, 0.5, 0, Math.PI * 2);
          ctx.ellipse(u * 0.3, -u * 0.35, u * 0.28, u * 0.24, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = spec.accent;
          ctx.beginPath();
          ctx.ellipse(0, 0, u * 0.08, u * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "yingchi":
          ctx.moveTo(-u * 0.85, 0);
          ctx.quadraticCurveTo(0, u * 0.75, u * 0.85, 0);
          ctx.lineTo(u * 0.85, -u * 0.35);
          ctx.quadraticCurveTo(0, -u * 0.05, -u * 0.85, -u * 0.35);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = spec.accent;
          ctx.beginPath();
          ctx.arc(0, u * 0.05, u * 0.18, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "shayan":
        // 沙燕：剪刀尾燕子
        default:
          ctx.moveTo(0, u * 0.55);
          ctx.quadraticCurveTo(-u * 0.5, u * 0.45, -u * 0.95, -u * 0.05);
          ctx.quadraticCurveTo(-u * 0.4, -u * 0.05, -u * 0.18, -u * 0.2);
          ctx.lineTo(-u * 0.22, -u * 0.85);
          ctx.lineTo(0, -u * 0.4);
          ctx.lineTo(u * 0.22, -u * 0.85);
          ctx.lineTo(u * 0.18, -u * 0.2);
          ctx.quadraticCurveTo(u * 0.4, -u * 0.05, u * 0.95, -u * 0.05);
          ctx.quadraticCurveTo(u * 0.5, u * 0.45, 0, u * 0.55);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = spec.accent;
          ctx.beginPath();
          ctx.arc(0, u * 0.32, u * 0.12, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
    }
    drawContacts(world2) {
      const { ctx } = this;
      for (const c of world2.contacts) {
        if (c.slide < 0.5) continue;
        const px = this.sx(c.x), py = this.sy(c.y);
        const r = clamp(c.slide, 0, 8) * 0.35 * this.scale * 0.15 + 2 * devicePixelRatio;
        ctx.strokeStyle = `rgba(255,${200 - clamp(c.slide, 0, 8) * 15},60,${clamp(c.slide / 4, 0.2, 0.95)})`;
        ctx.lineWidth = 1.5 * devicePixelRatio;
        for (let k = 0; k < 5; k++) {
          const a = Math.random() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
          ctx.stroke();
        }
      }
    }
    drawHud(world2, hud) {
      const { ctx } = this;
      const dp = devicePixelRatio;
      ctx.textAlign = "left";
      const ws = world2.wind.speed;
      ctx.fillStyle = "rgba(0,30,60,0.55)";
      ctx.fillRect(12 * dp, 12 * dp, 190 * dp, 54 * dp);
      ctx.fillStyle = "#fff";
      ctx.font = `${13 * dp}px sans-serif`;
      ctx.fillText(`\u98CE\u901F ${ws.toFixed(1)} m/s`, 22 * dp, 32 * dp);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(22 * dp, 42 * dp, 150 * dp, 8 * dp);
      ctx.fillStyle = ws > 8 ? "#ff9a3c" : "#7fe07f";
      ctx.fillRect(22 * dp, 42 * dp, clamp(ws / 12, 0, 1) * 150 * dp, 8 * dp);
      if (hud.mode === "battle" && world2.players.length === 2) {
        const names = ["\u6211\u65B9", hud.aiName ?? "\u5BF9\u65B9"];
        for (let i = 0; i < 2; i++) {
          const p = world2.players[i];
          const minInteg = this.minIntegrity(p);
          const bx = this.W / 2 + (i === 0 ? -260 : 60) * dp;
          ctx.fillStyle = "rgba(0,30,60,0.55)";
          ctx.fillRect(bx, 12 * dp, 200 * dp, 40 * dp);
          ctx.fillStyle = "#fff";
          ctx.font = `${12 * dp}px sans-serif`;
          ctx.fillText(`${names[i]}\u7EBF\u8010\u4E45`, bx + 10 * dp, 28 * dp);
          ctx.fillStyle = "rgba(255,255,255,0.25)";
          ctx.fillRect(bx + 10 * dp, 34 * dp, 180 * dp, 8 * dp);
          ctx.fillStyle = minInteg > 0.6 ? "#7fe07f" : minInteg > 0.3 ? "#e8b83a" : "#e83a2e";
          ctx.fillRect(bx + 10 * dp, 34 * dp, clamp(minInteg, 0, 1) * 180 * dp, 8 * dp);
        }
      }
      if (hud.mode === "test") {
        const p = world2.players[0];
        const theory = theoryAngle(hud.selSpec);
        const cur = p.flightAngle();
        const dev = hud.angleAvg - theory;
        ctx.fillStyle = "rgba(0,30,60,0.55)";
        ctx.fillRect(12 * dp, 76 * dp, 250 * dp, 96 * dp);
        ctx.fillStyle = "#fff";
        ctx.font = `${13 * dp}px sans-serif`;
        ctx.fillText(`\u5F53\u524D\u653E\u98DE\u89D2  ${cur.toFixed(1)}\xB0`, 22 * dp, 98 * dp);
        ctx.fillText(`5 \u79D2\u5E73\u5747    ${hud.angleAvg.toFixed(1)}\xB0`, 22 * dp, 120 * dp);
        ctx.fillText(`\u7406\u8BBA\u503C(\u5347\u963B\u6BD4) ${theory.toFixed(1)}\xB0`, 22 * dp, 142 * dp);
        ctx.fillStyle = Math.abs(dev) <= 3 ? "#7fe07f" : "#e8b83a";
        ctx.fillText(`\u504F\u5DEE ${dev >= 0 ? "+" : ""}${dev.toFixed(1)}\xB0\uFF08\u8981\u6C42 \u22643\xB0\uFF09`, 22 * dp, 164 * dp);
      }
      ctx.fillStyle = "rgba(0,30,60,0.45)";
      ctx.font = `${12 * dp}px sans-serif`;
      ctx.fillText("A/D \u6216 \u2190/\u2192 \u8D70\u52A8    W/S \u6216 \u2191/\u2193 \u6536\u7EBF/\u653E\u7EBF\uFF08\u6EDA\u8F6E\u4E5F\u884C\uFF09   \u731B\u653E\u7EBF\u53EF\u5272\u5BF9\u65B9\u7684\u7EBF", 12 * dp, this.H - 12 * dp);
      if (hud.message) {
        ctx.textAlign = "center";
        ctx.font = `bold ${34 * dp}px sans-serif`;
        ctx.fillStyle = "rgba(0,20,40,0.6)";
        ctx.fillText(hud.message, this.W / 2 + 2 * dp, this.H * 0.3 + 2 * dp);
        ctx.fillStyle = "#ffe08a";
        ctx.fillText(hud.message, this.W / 2, this.H * 0.3);
        ctx.textAlign = "left";
      }
    }
    minIntegrity(p) {
      let m = 1;
      for (let i = 0; i < N; i++) {
        const f = p.integrity[i] / p.lspec.strength;
        if (f < m) m = f;
      }
      return m;
    }
  };

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

  // src/records.ts
  var KEY = "dfz_records_v1";
  function loadRecords() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const r = JSON.parse(raw);
        if (typeof r.wins === "number" && Array.isArray(r.games)) return r;
      }
    } catch {
    }
    return { wins: 0, losses: 0, games: [] };
  }
  function saveRecord(rec) {
    const r = loadRecords();
    if (rec.result === "\u80DC") r.wins++;
    else r.losses++;
    r.games.unshift(rec);
    if (r.games.length > 50) r.games.length = 50;
    try {
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch {
    }
    return r;
  }

  // src/main.ts
  var DT = 1 / 120;
  var cv = document.getElementById("cv");
  var renderer = new Renderer(cv);
  var state = "select";
  var world = null;
  var ai = null;
  var selKite = KITES[0];
  var selLine = LINES[2];
  var aiKite = KITES[4];
  var matchT = 0;
  var recordSaved = false;
  var message = "";
  var messageT = 0;
  var keys = /* @__PURE__ */ new Set();
  var wheelReel = 0;
  window.addEventListener("keydown", (e) => {
    keys.add(e.code);
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheelReel = Math.max(-1.5, Math.min(1.5, wheelReel - Math.sign(e.deltaY) * 0.7));
  }, { passive: false });
  function readInput() {
    let reel = 0, walk = 0;
    if (keys.has("KeyW") || keys.has("ArrowUp")) reel += 1;
    if (keys.has("KeyS") || keys.has("ArrowDown")) reel -= 1;
    if (keys.has("KeyA") || keys.has("ArrowLeft")) walk -= 1;
    if (keys.has("KeyD") || keys.has("ArrowRight")) walk += 1;
    reel += wheelReel;
    return { reel: Math.max(-1, Math.min(1, reel)), walk };
  }
  var $ = (id) => document.getElementById(id);
  function showPage(name) {
    state = name;
    $("page-select").hidden = name !== "select";
    $("page-records").hidden = name !== "records";
    $("btn-exit").hidden = !(name === "test" || name === "battle");
    if (name !== "battle") $("overlay-result").hidden = true;
  }
  function statBar(label, v, max) {
    const pct = Math.round(v / max * 100);
    return `<div class="stat"><span>${label}</span><span>${v}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`;
  }
  function buildSelectPage() {
    const kl = $("kite-list");
    kl.innerHTML = "";
    for (const k of KITES) {
      const ld = (k.cl / k.cd).toFixed(1);
      const el = document.createElement("div");
      el.className = "card" + (k === selKite ? " sel" : "");
      el.innerHTML = `<div class="swatch" style="background:${k.color};border:3px solid ${k.accent}"></div><h3>${k.name}</h3><div class="origin">${k.origin}</div><div class="desc">${k.desc}</div>` + statBar("\u5347\u963B\u6BD4", +ld, 6) + statBar("\u4F53\u91CD", k.mass, 1) + statBar("\u7FFC\u9762", k.area, 1);
      el.onclick = () => {
        selKite = k;
        buildSelectPage();
      };
      kl.appendChild(el);
    }
    const ll = $("line-list");
    ll.innerHTML = "";
    for (const l of LINES) {
      const el = document.createElement("div");
      el.className = "card" + (l === selLine ? " sel" : "");
      el.innerHTML = `<div class="swatch" style="background:${l.color}"></div><h3>${l.name}</h3><div class="origin">\u73BB\u7483\u7C89 ${"\u2605".repeat(l.glass) || "\u65E0"}</div><div class="desc">${l.desc}</div>` + statBar("\u950B\u5229", l.wearFactor, 2.5) + statBar("\u8010\u78E8", l.strength, 1.8);
      el.onclick = () => {
        selLine = l;
        buildSelectPage();
      };
      ll.appendChild(el);
    }
  }
  function buildRecordsPage() {
    const r = loadRecords();
    $("records-summary").textContent = `\u5171 ${r.wins + r.losses} \u573A \u2014\u2014 \u80DC ${r.wins} / \u8D1F ${r.losses}` + (r.wins + r.losses > 0 ? `\uFF0C\u80DC\u7387 ${Math.round(r.wins / (r.wins + r.losses) * 100)}%` : "");
    const tb = $("records-table").querySelector("tbody");
    tb.innerHTML = "";
    for (const g of r.games) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${g.d}</td><td>${g.kite}</td><td>${g.line}</td><td>${g.foe}</td><td class="${g.result === "\u80DC" ? "win" : "lose"}">${g.result}</td><td>${g.dur.toFixed(0)}s</td>`;
      tb.appendChild(tr);
    }
    if (r.games.length === 0) {
      tb.innerHTML = '<tr><td colspan="6">\u8FD8\u6CA1\u6709\u6218\u7EE9\uFF0C\u53BB\u6597\u4E00\u573A\u5427</td></tr>';
    }
  }
  function makeWorld(mode) {
    const w = new World(mode);
    w.wind.base = 5.5 + Math.random() * 2.5;
    const me = new Player(selKite, selLine, mode === "battle" ? -12 : 0);
    me.len = 70;
    me.reset(theoryAngle(selKite));
    w.addPlayer(me);
    if (mode === "battle") {
      aiKite = KITES[Math.floor(Math.random() * KITES.length)];
      const foe = new Player(aiKite, LINES[2], 12);
      foe.len = 70;
      foe.reset(theoryAngle(aiKite));
      w.addPlayer(foe);
      ai = new AIController(1);
    }
    return w;
  }
  function startTest() {
    world = makeWorld("test");
    angleBuf.length = 0;
    message = "";
    showPage("test");
  }
  function startBattle() {
    world = makeWorld("battle");
    matchT = 0;
    recordSaved = false;
    message = "\u6597\uFF01";
    messageT = 1.5;
    showPage("battle");
  }
  function endBattle() {
    if (!world || recordSaved) return;
    recordSaved = true;
    const iWon = world.loser === 1;
    saveRecord({
      d: (/* @__PURE__ */ new Date()).toLocaleDateString("zh-CN"),
      kite: selKite.name,
      line: selLine.name,
      foe: aiKite.name,
      result: iWon ? "\u80DC" : "\u8D1F",
      dur: matchT
    });
    $("result-title").textContent = iWon ? "\u8D62\u4E86\uFF01" : "\u7EBF\u65AD\u4E86\u2026\u2026";
    $("result-title").style.color = iWon ? "#8fe08f" : "#e88a7a";
    $("result-detail").textContent = iWon ? `\u5BF9\u65B9\u7684${aiKite.name}\u65AD\u7EBF\u98D8\u8D70\u4E86\uFF0C\u7528\u65F6 ${matchT.toFixed(0)} \u79D2\u3002` : `\u4F60\u7684${selKite.name}\u65AD\u7EBF\u98D8\u8D70\u4E86\uFF0C\u7528\u65F6 ${matchT.toFixed(0)} \u79D2\u3002`;
    $("overlay-result").hidden = false;
  }
  $("btn-test").onclick = startTest;
  $("btn-battle").onclick = startBattle;
  $("btn-records").onclick = () => {
    buildRecordsPage();
    showPage("records");
  };
  $("btn-records-back").onclick = () => showPage("select");
  $("btn-exit").onclick = () => {
    world = null;
    showPage("select");
  };
  $("btn-again").onclick = () => {
    $("overlay-result").hidden = true;
    startBattle();
  };
  $("btn-back-select").onclick = () => {
    world = null;
    showPage("select");
  };
  window.addEventListener("resize", () => renderer.resize());
  var angleBuf = [];
  var last = performance.now();
  var acc = 0;
  var tGlobal = 0;
  function frame(now) {
    let dt = (now - last) / 1e3;
    last = now;
    if (dt > 0.1) dt = 0.1;
    tGlobal += dt;
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 8) {
      step(DT);
      acc -= DT;
      n++;
    }
    if (n === 8) acc = 0;
    wheelReel *= Math.pow(0.02, dt);
    if (Math.abs(wheelReel) < 0.02) wheelReel = 0;
    let hud = null;
    if (world && (state === "test" || state === "battle")) {
      const me = world.players[0];
      angleBuf.push(me.flightAngle());
      if (angleBuf.length > 600) angleBuf.shift();
      const avg = angleBuf.length ? angleBuf.reduce((a, b) => a + b, 0) / angleBuf.length : 0;
      if (messageT > 0) messageT -= dt;
      hud = {
        mode: state,
        selSpec: selKite,
        angleAvg: avg,
        aiName: aiKite.name,
        message: messageT > 0 ? message : void 0
      };
      if (state === "battle" && world.phase === "done") endBattle();
      if (state === "battle" && world.phase === "broken" && world.loser >= 0) {
        hud.message = world.loser === 0 ? "\u6211\u65B9\u7EBF\u65AD\uFF01" : "\u5BF9\u65B9\u7EBF\u65AD\uFF01";
      }
    }
    renderer.render(world, hud, dt, tGlobal);
    requestAnimationFrame(frame);
  }
  function step(dt) {
    if (!world || state !== "test" && state !== "battle") return;
    const me = world.players[0];
    if (world.phase === "fight") {
      const inp = readInput();
      me.input.reel = inp.reel;
      me.input.walk = inp.walk;
    } else {
      me.input.reel = 0;
      me.input.walk = 0;
    }
    if (state === "battle" && world.players.length === 2 && ai) {
      ai.update(world, world.players[1], me, dt);
      matchT += dt;
    }
    world.step(dt);
  }
  buildSelectPage();
  showPage("select");
  requestAnimationFrame(frame);
})();
