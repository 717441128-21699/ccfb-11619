// Canvas 渲染：天空、地面、风粒子、线（按耐久变色）、风筝剪影、火花、HUD

import { World, Player, N } from './physics';
import { KiteSpec, theoryAngle } from './kites';
import { clamp, lerp } from './util';

const KITE_VIS = 2.4; // 风筝视觉放大倍数（不然太小看不见）

interface Particle { x: number; y: number; }
interface Cloud { x: number; y: number; s: number; }

export interface HudInfo {
  mode: 'test' | 'battle';
  selSpec: KiteSpec;
  angleAvg: number;      // 试飞页 5 秒平均角度
  aiName?: string;
  message?: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private cx = 30;
  private cy = 45;
  private scale = 8;
  private particles: Particle[] = [];
  private clouds: Cloud[] = [];
  W = 0;
  H = 0;

  constructor(private cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!;
    this.resize();
    for (let i = 0; i < 70; i++) {
      this.particles.push({ x: Math.random() * 200 - 40, y: Math.random() * 120 });
    }
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ x: Math.random() * 250 - 50, y: 40 + Math.random() * 70, s: 6 + Math.random() * 10 });
    }
  }

  resize(): void {
    this.W = this.cv.width = this.cv.clientWidth * devicePixelRatio;
    this.H = this.cv.height = this.cv.clientHeight * devicePixelRatio;
  }

  private sx(x: number): number { return this.W / 2 + (x - this.cx) * this.scale; }
  private sy(y: number): number { return this.H / 2 - (y - this.cy) * this.scale; }

  private updateCamera(world: World, dt: number): void {
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (const p of world.players) {
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

  render(world: World | null, hud: HudInfo | null, dt: number, tGlobal: number): void {
    const { ctx } = this;
    const windSpeed = world ? world.wind.speed : 5;
    const windVy = world ? world.wind.vy : 0;

    // 天空
    const grad = ctx.createLinearGradient(0, 0, 0, this.H);
    grad.addColorStop(0, '#7db8e8');
    grad.addColorStop(0.6, '#a8d0ee');
    grad.addColorStop(1, '#d8ecf7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.W, this.H);

    // 云（跟着风飘）
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const c of this.clouds) {
      c.x += windSpeed * dt * 0.9;
      if (this.sx(c.x) - c.s * this.scale > this.W) c.x -= (this.W / this.scale) + c.s * 4;
      const px = this.sx(c.x), py = this.sy(c.y);
      ctx.beginPath();
      ctx.ellipse(px, py, c.s * this.scale * 0.9, c.s * this.scale * 0.32, 0, 0, Math.PI * 2);
      ctx.ellipse(px + c.s * this.scale * 0.5, py + c.s * this.scale * 0.1, c.s * this.scale * 0.6, c.s * this.scale * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 风粒子
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1 * devicePixelRatio;
    for (const pt of this.particles) {
      pt.x += windSpeed * dt;
      pt.y += windVy * dt;
      if (this.sx(pt.x) > this.W + 20) { pt.x -= this.W / this.scale + 40; pt.y = Math.random() * 120; }
      const px = this.sx(pt.x), py = this.sy(pt.y);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - windSpeed * this.scale * 0.12, py + windVy * this.scale * 0.12);
      ctx.stroke();
    }

    // 地面
    const gy = this.sy(0);
    const ggrad = ctx.createLinearGradient(0, gy, 0, this.H);
    ggrad.addColorStop(0, '#7aa05c');
    ggrad.addColorStop(1, '#5c7f44');
    ctx.fillStyle = ggrad;
    ctx.fillRect(0, gy, this.W, this.H - gy);
    // 距离刻度
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = `${10 * devicePixelRatio}px sans-serif`;
    ctx.textAlign = 'center';
    const step = 20;
    const x0 = Math.floor((this.cx - this.W / 2 / this.scale) / step) * step;
    for (let x = x0; this.sx(x) < this.W + 20; x += step) {
      ctx.fillRect(this.sx(x), gy, 1, 5 * devicePixelRatio);
      ctx.fillText(`${x}m`, this.sx(x), gy + 16 * devicePixelRatio);
    }

    if (world) {
      this.updateCamera(world, dt);
      for (let i = 0; i < world.players.length; i++) {
        this.drawPlayer(world.players[i], i === 0 ? '#2266cc' : '#cc3322', tGlobal);
      }
      for (const p of world.players) this.drawLine(p);
      for (const p of world.players) this.drawKite(p, tGlobal, world.t);
      this.drawContacts(world);
    }
    if (hud && world) this.drawHud(world, hud);
  }

  private drawPlayer(p: Player, color: string, t: number): void {
    const { ctx } = this;
    const px = this.sx(p.anchorX), py = this.sy(0);
    const s = this.scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2 * devicePixelRatio;
    // 小人
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
    // 手臂指向线（收线时手臂动）
    const reel = p.input.reel;
    const ay = py - 1.0 * s + Math.sin(t * 10) * reel * 0.1 * s;
    ctx.moveTo(px, py - 1.1 * s);
    ctx.lineTo(px + 0.35 * s, ay);
    ctx.stroke();
    // 线轴
    ctx.beginPath();
    ctx.arc(px + 0.35 * s, ay, 0.12 * s, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawLine(p: Player): void {
    const { ctx } = this;
    ctx.lineWidth = Math.max(1, 1.3 * devicePixelRatio);
    const end = p.broken ? p.breakAt : N;
    // 锚侧（断后垂落）
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

  private integrityColor(f: number, base: string): string {
    const c = clamp(f, 0, 1);
    if (c > 0.6) return base;
    if (c > 0.3) return '#e8b83a';
    return '#e83a2e';
  }

  private drawKite(p: Player, tGlobal: number, tWorld: number): void {
    const { ctx } = this;
    const kx = this.sx(p.kiteX), ky = this.sy(p.kiteY);
    // 朝向：沿最后一节线的方向；断线后翻滚
    let ang: number;
    if (p.broken) {
      ang = tWorld * 3.5;
    } else {
      const i = N - 1;
      ang = Math.atan2(p.y[N] - p.y[i], p.x[N] - p.x[i]) - Math.PI / 2;
      ang += Math.sin(tGlobal * 7 + p.anchorX) * 0.05; // 微微抖翅
    }
    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate(ang);
    const u = this.scale * KITE_VIS * Math.sqrt(p.spec.area);
    this.drawShape(p.spec, u);
    ctx.restore();
  }

  private drawShape(spec: KiteSpec, u: number): void {
    const { ctx } = this;
    ctx.fillStyle = spec.color;
    ctx.strokeStyle = spec.accent;
    ctx.lineWidth = Math.max(1, u * 0.06);
    ctx.beginPath();
    switch (spec.shape) {
      case 'dou': // 打斗筝：菱形
        ctx.moveTo(0, u * 0.9); ctx.lineTo(u * 0.62, 0); ctx.lineTo(0, -u * 0.9); ctx.lineTo(-u * 0.62, 0);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, u * 0.9); ctx.lineTo(0, -u * 0.9);
        ctx.moveTo(-u * 0.62, 0); ctx.lineTo(u * 0.62, 0); ctx.stroke();
        break;
      case 'banyao': // 板鹞：六角板 + 哨口
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          const px = Math.cos(a) * u * 0.85, py = Math.sin(a) * u * 0.85;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = spec.accent;
        for (const [cx, cy, r] of [[0, 0, 0.22], [-0.35, 0.25, 0.13], [0.35, 0.25, 0.13], [0, -0.4, 0.13]] as const) {
          ctx.beginPath(); ctx.arc(cx * u, cy * u, r * u, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'hudie': // 蝴蝶
        ctx.ellipse(-u * 0.42, u * 0.25, u * 0.42, u * 0.34, -0.4, 0, Math.PI * 2);
        ctx.ellipse(u * 0.42, u * 0.25, u * 0.42, u * 0.34, 0.4, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(-u * 0.3, -u * 0.35, u * 0.28, u * 0.24, 0.5, 0, Math.PI * 2);
        ctx.ellipse(u * 0.3, -u * 0.35, u * 0.28, u * 0.24, -0.5, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = spec.accent;
        ctx.beginPath(); ctx.ellipse(0, 0, u * 0.08, u * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'yingchi': // 硬翅：上弧下方的架子
        ctx.moveTo(-u * 0.85, 0);
        ctx.quadraticCurveTo(0, u * 0.75, u * 0.85, 0);
        ctx.lineTo(u * 0.85, -u * 0.35);
        ctx.quadraticCurveTo(0, -u * 0.05, -u * 0.85, -u * 0.35);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = spec.accent;
        ctx.beginPath(); ctx.arc(0, u * 0.05, u * 0.18, 0, Math.PI * 2); ctx.fill();
        break;
      case 'shayan': // 沙燕：剪刀尾燕子
      default:
        ctx.moveTo(0, u * 0.55);                       // 头
        ctx.quadraticCurveTo(-u * 0.5, u * 0.45, -u * 0.95, -u * 0.05); // 左翅
        ctx.quadraticCurveTo(-u * 0.4, -u * 0.05, -u * 0.18, -u * 0.2);
        ctx.lineTo(-u * 0.22, -u * 0.85);              // 左尾羽
        ctx.lineTo(0, -u * 0.4);
        ctx.lineTo(u * 0.22, -u * 0.85);               // 右尾羽
        ctx.lineTo(u * 0.18, -u * 0.2);
        ctx.quadraticCurveTo(u * 0.4, -u * 0.05, u * 0.95, -u * 0.05);  // 右翅
        ctx.quadraticCurveTo(u * 0.5, u * 0.45, 0, u * 0.55);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.fillStyle = spec.accent;
        ctx.beginPath(); ctx.arc(0, u * 0.32, u * 0.12, 0, Math.PI * 2); ctx.fill();
        break;
    }
  }

  private drawContacts(world: World): void {
    const { ctx } = this;
    for (const c of world.contacts) {
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

  private drawHud(world: World, hud: HudInfo): void {
    const { ctx } = this;
    const dp = devicePixelRatio;
    ctx.textAlign = 'left';
    // 风速表
    const ws = world.wind.speed;
    ctx.fillStyle = 'rgba(0,30,60,0.55)';
    ctx.fillRect(12 * dp, 12 * dp, 190 * dp, 54 * dp);
    ctx.fillStyle = '#fff';
    ctx.font = `${13 * dp}px sans-serif`;
    ctx.fillText(`风速 ${ws.toFixed(1)} m/s`, 22 * dp, 32 * dp);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(22 * dp, 42 * dp, 150 * dp, 8 * dp);
    ctx.fillStyle = ws > 8 ? '#ff9a3c' : '#7fe07f';
    ctx.fillRect(22 * dp, 42 * dp, clamp(ws / 12, 0, 1) * 150 * dp, 8 * dp);

    if (hud.mode === 'battle' && world.players.length === 2) {
      // 双方线耐久
      const names = ['我方', hud.aiName ?? '对方'];
      for (let i = 0; i < 2; i++) {
        const p = world.players[i];
        const minInteg = this.minIntegrity(p);
        const bx = this.W / 2 + (i === 0 ? -260 : 60) * dp;
        ctx.fillStyle = 'rgba(0,30,60,0.55)';
        ctx.fillRect(bx, 12 * dp, 200 * dp, 40 * dp);
        ctx.fillStyle = '#fff';
        ctx.font = `${12 * dp}px sans-serif`;
        ctx.fillText(`${names[i]}线耐久`, bx + 10 * dp, 28 * dp);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(bx + 10 * dp, 34 * dp, 180 * dp, 8 * dp);
        ctx.fillStyle = minInteg > 0.6 ? '#7fe07f' : minInteg > 0.3 ? '#e8b83a' : '#e83a2e';
        ctx.fillRect(bx + 10 * dp, 34 * dp, clamp(minInteg, 0, 1) * 180 * dp, 8 * dp);
      }
    }

    if (hud.mode === 'test') {
      const p = world.players[0];
      const theory = theoryAngle(hud.selSpec);
      const cur = p.flightAngle();
      const dev = hud.angleAvg - theory;
      ctx.fillStyle = 'rgba(0,30,60,0.55)';
      ctx.fillRect(12 * dp, 76 * dp, 250 * dp, 96 * dp);
      ctx.fillStyle = '#fff';
      ctx.font = `${13 * dp}px sans-serif`;
      ctx.fillText(`当前放飞角  ${cur.toFixed(1)}°`, 22 * dp, 98 * dp);
      ctx.fillText(`5 秒平均    ${hud.angleAvg.toFixed(1)}°`, 22 * dp, 120 * dp);
      ctx.fillText(`理论值(升阻比) ${theory.toFixed(1)}°`, 22 * dp, 142 * dp);
      ctx.fillStyle = Math.abs(dev) <= 3 ? '#7fe07f' : '#e8b83a';
      ctx.fillText(`偏差 ${dev >= 0 ? '+' : ''}${dev.toFixed(1)}°（要求 ≤3°）`, 22 * dp, 164 * dp);
    }

    // 操作提示
    ctx.fillStyle = 'rgba(0,30,60,0.45)';
    ctx.font = `${12 * dp}px sans-serif`;
    ctx.fillText('A/D 或 ←/→ 走动    W/S 或 ↑/↓ 收线/放线（滚轮也行）   猛放线可割对方的线', 12 * dp, this.H - 12 * dp);

    if (hud.message) {
      ctx.textAlign = 'center';
      ctx.font = `bold ${34 * dp}px sans-serif`;
      ctx.fillStyle = 'rgba(0,20,40,0.6)';
      ctx.fillText(hud.message, this.W / 2 + 2 * dp, this.H * 0.3 + 2 * dp);
      ctx.fillStyle = '#ffe08a';
      ctx.fillText(hud.message, this.W / 2, this.H * 0.3);
      ctx.textAlign = 'left';
    }
  }

  private minIntegrity(p: Player): number {
    let m = 1;
    for (let i = 0; i < N; i++) {
      const f = p.integrity[i] / p.lspec.strength;
      if (f < m) m = f;
    }
    return m;
  }
}
