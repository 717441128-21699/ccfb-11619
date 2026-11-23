// 物理核心：
//  风筝 —— 质点，升力 ⊥ 相对风、阻力 ∥ 相对风、重力、姿态阻尼，与线的张力平衡
//  线   —— 300 个有质量的节点（Verlet + 距离约束），会下垂、会飘
//  张线 —— 锚点到风筝的系留约束：距离超过当前线长即拉回（线绷紧传张力），松了不管（线可以垂）
//  磨损 —— 两线交叉处按相对滑动速度 × 对方玻璃粉等级掉耐久，先断者输

import { Wind } from './wind';
import { KiteSpec, LineSpec } from './kites';
import { clamp } from './util';

export const RHO = 1.225; // 空气密度 kg/m³
export const G = 9.81;
export const N = 300; // 每条线的节点数（索引 N 是风筝）

const CD_LINE = 0.9;      // 线的阻力系数
const ITERS = 12;         // 链约束迭代次数（每次正反向各扫一遍）
const R_CONTACT = 0.12;   // 两线接触半径 m
const WEAR_K = 0.06;      // 磨损基础系数
const FRICTION = 0.12;    // 接触摩擦（挂线感）
const SLIDE_MIN = 0.25;   // 低于此滑动速度不磨损 m/s

export const WALK_SPEED = 3;   // 走动速度 m/s
export const REEL_IN = 6;      // 收线速度 m/s
export const REEL_OUT = 11;    // 放线速度 m/s（猛放是割线的关键）
export const MIN_LEN = 35;
export const MAX_LEN = 160;

export interface Contact { x: number; y: number; slide: number; }

export class Player {
  anchorX: number;
  anchorY = 0;
  // 线节点 0..N-1，索引 N 为风筝（Verlet：x/y 当前，ox/oy 上一步）
  x = new Float64Array(N + 1);
  y = new Float64Array(N + 1);
  ox = new Float64Array(N + 1);
  oy = new Float64Array(N + 1);
  /** 每个线节点的剩余耐久，降到 0 即断 */
  integrity = new Float64Array(N);
  len = 60;
  broken = false;
  breakAt = -1;
  landed = false;
  input = { reel: 0, walk: 0 };

  constructor(public spec: KiteSpec, public lspec: LineSpec, ax: number) {
    this.anchorX = ax;
    this.reset();
  }

  get kiteX(): number { return this.x[N]; }
  get kiteY(): number { return this.y[N]; }
  get segLen(): number { return this.len / N; }

  reset(angleDeg = 62): void {
    const a = (angleDeg * Math.PI) / 180;
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
  flightAngle(): number {
    return (Math.atan2(this.kiteY - this.anchorY, this.kiteX - this.anchorX) * 180) / Math.PI;
  }
}

/** 线段最近点参数（2D），返回 [s, t, 距离²] */
function segSegClosest(
  a1x: number, a1y: number, a2x: number, a2y: number,
  b1x: number, b1y: number, b2x: number, b2y: number,
): [number, number, number] {
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
  if (t < 0) { t = 0; s = a > 1e-12 ? -c / a : 0; }
  else if (t > 1) { t = 1; s = a > 1e-12 ? (b - c) / a : 0; }
  s = clamp(s, 0, 1);
  const px = a1x + d1x * s - (b1x + d2x * t);
  const py = a1y + d1y * s - (b1y + d2y * t);
  return [s, t, px * px + py * py];
}

export class World {
  players: Player[] = [];
  wind: Wind;
  t = 0;
  contacts: Contact[] = [];
  phase: 'fight' | 'broken' | 'done' = 'fight';
  loser = -1;
  endTimer = 0;

  private fx = new Float64Array(N + 1);
  private fy = new Float64Array(N + 1);
  private grid = new Map<number, number[]>();
  private stamp = new Int32Array(N);
  private stampId = 0;

  constructor(public mode: 'test' | 'battle', rnd?: () => number) {
    this.wind = new Wind(rnd);
  }

  addPlayer(p: Player): void { this.players.push(p); }

  step(dt: number): void {
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
    if (
      this.players.length === 2 &&
      !this.players[0].broken && !this.players[1].broken
    ) {
      this.collideLines(dt);
    }
    if (this.phase === 'fight') {
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (p.broken) continue;
        for (let k = 0; k < N; k++) {
          if (p.integrity[k] <= 0) {
            p.broken = true;
            p.breakAt = Math.max(1, k);
            this.phase = 'broken';
            this.loser = i;
            break;
          }
        }
      }
    } else if (this.phase === 'broken') {
      this.endTimer += dt;
      if (this.endTimer > 3.5) this.phase = 'done';
    }
  }

  private integrate(p: Player, dt: number): void {
    const { x, y, ox, oy } = p;
    const seg = p.segLen;
    const nodeMass = p.lspec.density * seg;
    const fx = this.fx, fy = this.fy;
    fx.fill(0); fy.fill(0);

    // 线的空气阻力：按段计算，分摊到两端节点
    const dragArea = p.lspec.diameter * seg;
    for (let i = 0; i < N; i++) {
      if (p.broken && i === p.breakAt - 1) continue;
      const mx = (x[i] + x[i + 1]) * 0.5;
      const my = (y[i] + y[i + 1]) * 0.5;
      const mvx = (x[i] - ox[i] + x[i + 1] - ox[i + 1]) * 0.5 / dt;
      const mvy = (y[i] - oy[i] + y[i + 1] - oy[i + 1]) * 0.5 / dt;
      const w = this.wind.at(my);
      const wx = w.x - mvx, wy = w.y - mvy;
      const sp = Math.hypot(wx, wy);
      if (sp < 0.01) continue;
      const f = 0.5 * RHO * sp * sp * dragArea * CD_LINE;
      const fxv = (f * wx) / sp, fyv = (f * wy) / sp;
      fx[i] += fxv * 0.5; fy[i] += fyv * 0.5;
      fx[i + 1] += fxv * 0.5; fy[i + 1] += fyv * 0.5;
    }
    // 节点重力
    for (let i = 1; i < N; i++) fy[i] -= nodeMass * G;

    // 风筝：升力 ⊥ 相对风，阻力 ∥ 相对风，加重力与姿态阻尼
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
      const cd = p.broken ? 1.25 : p.spec.cd; // 断线后翻滚，只剩阻力
      let lx = -uy, ly = ux;
      if (ly < 0) { lx = -lx; ly = -ly; }
      kfx += lx * q * cl + ux * q * cd;
      kfy += ly * q * cl + uy * q * cd;
    }
    const damp = (p.broken ? 1.0 : 0.35) * m;
    kfx -= kvx * damp;
    kfy -= kvy * damp;
    fx[N] += kfx; fy[N] += kfy;

    // Verlet 积分
    const dt2 = dt * dt;
    const start = p.broken ? 0 : 1;
    for (let i = start; i <= N; i++) {
      const mass = i === N ? m : nodeMass;
      const nx = x[i] + (x[i] - ox[i]) * 0.999 + (fx[i] / mass) * dt2;
      const ny = y[i] + (y[i] - oy[i]) * 0.999 + (fy[i] / mass) * dt2;
      ox[i] = x[i]; oy[i] = y[i];
      x[i] = nx; y[i] = ny;
    }
    if (!p.broken) {
      x[0] = p.anchorX; y[0] = p.anchorY;
      ox[0] = x[0]; oy[0] = y[0];
    }
    // 地面：线节点不入土，风筝落地停住
    for (let i = 0; i < N; i++) {
      if (y[i] < 0.03) { y[i] = 0.03; oy[i] = y[i]; }
    }
    if (y[N] <= 0.4) {
      y[N] = 0.4;
      if (oy[N] < y[N]) oy[N] = y[N];
      if (p.broken) {
        p.landed = true;
        ox[N] = x[N] - this.wind.at(1).x * dt * 0.2; // 贴着地面被风推着走
      } else if (p.input.reel > 0.5) {
        // 落地后猛收线 = 提线起飞
        oy[N] = y[N] + 5 * dt;
      }
    }
  }

  /** 系留约束：风筝不得离锚点超过线长（绷紧时这就是线的张力） */
  private tether(p: Player): void {
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
  private solveChain(p: Player): void {
    const { x, y } = p;
    const seg = p.segLen;
    for (let it = 0; it < ITERS; it++) {
      for (let d = 0; d < 2; d++) {
        const fwd = d === 0;
        for (let s = 0; s < N; s++) {
          const i = fwd ? s : N - 1 - s;
          if (p.broken && i === p.breakAt - 1) continue;
          const j = i + 1;
          // 未断时：节点 0（锚点）与节点 N（风筝）固定；断线后只有断点以风筝侧自由
          const pinI = !p.broken ? i === 0 : false;
          const pinJ = !p.broken && j === N;
          const dx = x[j] - x[i], dy = y[j] - y[i];
          const dist = Math.hypot(dx, dy) || 1e-9;
          const diff = (dist - seg) / dist;
          if (pinI && pinJ) continue;
          if (pinI) {
            x[j] -= dx * diff; y[j] -= dy * diff;
          } else if (pinJ) {
            x[i] += dx * diff; y[i] += dy * diff;
          } else {
            const half = diff * 0.5;
            x[i] += dx * half; y[i] += dy * half;
            x[j] -= dx * half; y[j] -= dy * half;
          }
        }
      }
    }
    if (!p.broken) { x[0] = p.anchorX; y[0] = p.anchorY; }
  }

  /** 两线交叉判定 + 磨损：A 线段入均匀网格，B 线段查询 */
  private collideLines(dt: number): void {
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
          const key = cx * 100000 + cy;
          let arr = grid.get(key);
          if (!arr) { arr = []; grid.set(key, arr); }
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
          const arr = grid.get(cx * 100000 + cy);
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
  private movable(p: Player, idx: number): boolean {
    if (idx === N) return p.broken; // 风筝位置由它自己的积分+系留管
    if (idx === 0) return p.broken;
    return true;
  }

  private contactPair(A: Player, i: number, B: Player, j: number, dt: number): void {
    const [s, t, d2] = segSegClosest(
      A.x[i], A.y[i], A.x[i + 1], A.y[i + 1],
      B.x[j], B.y[j], B.x[j + 1], B.y[j + 1],
    );
    if (d2 > R_CONTACT * R_CONTACT) return;
    const d = Math.sqrt(d2);

    const pax = A.x[i] + (A.x[i + 1] - A.x[i]) * s;
    const pay = A.y[i] + (A.y[i + 1] - A.y[i]) * s;
    const pbx = B.x[j] + (B.x[j + 1] - B.x[j]) * t;
    const pby = B.y[j] + (B.y[j + 1] - B.y[j]) * t;

    // 接触点处两线的相对滑动（位置差分即速度×dt）
    const vax = (A.x[i] - A.ox[i]) * (1 - s) + (A.x[i + 1] - A.ox[i + 1]) * s;
    const vay = (A.y[i] - A.oy[i]) * (1 - s) + (A.y[i + 1] - A.oy[i + 1]) * s;
    const vbx = (B.x[j] - B.ox[j]) * (1 - t) + (B.x[j + 1] - B.ox[j + 1]) * t;
    const vby = (B.y[j] - B.oy[j]) * (1 - t) + (B.y[j + 1] - B.oy[j + 1]) * t;
    const rvx = vax - vbx, rvy = vay - vby;

    let nx = pbx - pax, ny = pby - pay;
    if (d > 1e-5) { nx /= d; ny /= d; }
    else {
      // 正好交叉：取 B 切线垂线
      const tx = B.x[j + 1] - B.x[j], ty = B.y[j + 1] - B.y[j];
      const tl = Math.hypot(tx, ty) || 1;
      nx = -ty / tl; ny = tx / tl;
    }
    const vn = rvx * nx + rvy * ny;
    const svx = rvx - vn * nx, svy = rvy - vn * ny;
    const slide = Math.hypot(svx, svy) / dt; // 相对滑动速度 m/s

    // 磨损：各自的损耗 = 对方玻璃粉等级 × 相对滑动速度
    if (slide > SLIDE_MIN) {
      const ia = s < 0.5 ? i : i + 1;
      const ib = t < 0.5 ? j : j + 1;
      if (ia < N) A.integrity[ia] -= WEAR_K * B.lspec.wearFactor * slide * dt;
      if (ib < N) B.integrity[ib] -= WEAR_K * A.lspec.wearFactor * slide * dt;
    }

    // 位置推离（线不会互相穿过），不可动的节点不动
    if (d > 1e-4) {
      const push = (R_CONTACT - d) * 0.5;
      const wA = this.movable(A, i) ? 1 : 0;
      const wB = this.movable(B, j) ? 1 : 0;
      const wSum = wA + wB || 1;
      const pA = (push * 2 * wA) / wSum * 0.5;
      const pB = (push * 2 * wB) / wSum * 0.5;
      A.x[i] -= nx * pA * (1 - s); A.y[i] -= ny * pA * (1 - s);
      if (i + 1 < N || A.broken) { A.x[i + 1] -= nx * pA * s; A.y[i + 1] -= ny * pA * s; }
      B.x[j] += nx * pB * (1 - t); B.y[j] += ny * pB * (1 - t);
      if (j + 1 < N || B.broken) { B.x[j + 1] += nx * pB * s; B.y[j + 1] += ny * pB * t; }
    }

    // 摩擦：削减相对滑动，产生"挂住"的手感
    const ia2 = s < 0.5 ? i : i + 1;
    const ib2 = t < 0.5 ? j : j + 1;
    const fr = FRICTION * 0.5;
    if (this.movable(A, ia2)) { A.ox[ia2] += svx * fr; A.oy[ia2] += svy * fr; }
    if (this.movable(B, ib2)) { B.ox[ib2] -= svx * fr; B.oy[ib2] -= svy * fr; }

    this.contacts.push({ x: (pax + pbx) / 2, y: (pay + pby) / 2, slide });
  }
}
