// 风场模型：基础风 + 多层正弦阵风 + 突发阵风事件 + 低空边界层

export class Wind {
  /** 参考高度基础风速 m/s */
  base = 6;
  /** 定风模式（验证物理时用，关掉一切阵风） */
  steady = false;
  /** 当前参考高度水平风速 */
  speed = 6;
  /** 当前垂直扰动 */
  vy = 0;
  t = 0;

  private ph: number[] = [];
  private gustValue = 0;
  private gustTarget = 0;
  private gustTimer = 0;
  private nextGustIn = 6;

  constructor(private rnd: () => number = Math.random) {
    for (let i = 0; i < 5; i++) this.ph.push(rnd() * Math.PI * 2);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.steady) {
      this.speed = this.base;
      this.vy = 0;
      return;
    }
    const t = this.t, p = this.ph;
    // 缓变的阵风背景：几层不同频率的正弦叠加，忽大忽小
    const g =
      0.22 * Math.sin(0.13 * t + p[0]) +
      0.15 * Math.sin(0.47 * t + p[1]) +
      0.08 * Math.sin(1.9 * t + p[2]);
    // 突发阵风事件：每隔 6~20 秒来一股 1.5~4.5 秒的硬风
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
  at(y: number): { x: number; y: number } {
    const f = Math.min(1.12, Math.max(0.4, Math.pow(Math.max(y, 0.5) / 8, 0.15)));
    return { x: this.speed * f, y: this.vy * f };
  }
}
