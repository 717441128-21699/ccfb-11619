// 对手 AI：先把风筝送到你风筝旁边抢位置，线一挂上就猛放快收地锯

import { World, Player } from './physics';

export class AIController {
  private mode: 'approach' | 'saw' = 'approach';
  private sawT = 0;
  private thinkT = 0;
  private reelCmd = 0;
  private walkCmd = 0;

  constructor(private skill = 1) {}

  update(w: World, me: Player, foe: Player, dt: number): void {
    const inp = me.input;
    if (me.broken || w.phase !== 'fight') {
      inp.reel = 0; inp.walk = 0;
      return;
    }

    if (w.contacts.length > 0) {
      this.mode = 'saw';
      this.sawT = 0.8 + Math.random() * 0.6;
    }

    if (this.mode === 'saw') {
      this.sawT -= dt;
      // 拉锯节奏：猛放让线从对方线上刮过去，再猛收绷住
      const ph = this.sawT * (5 + this.skill * 2);
      inp.reel = Math.sin(ph) > 0.2 ? -1 : 0.8;
      inp.walk = 0;
      if (this.sawT <= 0) this.mode = 'approach';
      return;
    }

    // 接近策略：把风筝送到对方风筝上风边一点点，逼两线相交
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.18 / this.skill; // 反应间隔
      const tx = foe.kiteX + 3;
      const ty = foe.kiteY + 2.5;
      const offX = me.kiteX - me.anchorX; // 当前风下的水平偏移
      const dw = tx - offX - me.anchorX;
      this.walkCmd = Math.abs(dw) > 1.5 ? Math.sign(dw) * 0.9 : 0;
      const dy = ty - me.kiteY;
      this.reelCmd = dy > 2 ? 0.85 : dy < -4 ? -0.6 : 0;
    }
    inp.walk = this.walkCmd;
    inp.reel = this.reelCmd;
  }
}
