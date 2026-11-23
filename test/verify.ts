// 无头验证：
//  1) 每种风筝在稳定风下的放飞角与 atan(升阻比) 理论值之差 ≤ 3°
//  2) 两条 300 节点的线做交叉判定+磨损，120Hz 下单步耗时达标
//  3) 磨损能真的把线磨断（输的条件成立）

import { World, Player, N } from '../src/physics';
import { KITES, LINES, theoryAngle } from '../src/kites';
import { mulberry32 } from '../src/util';
import { AIController } from '../src/ai';

declare const process: { exit(code: number): never };

const DT = 1 / 120;
let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
}

// ---------- 1) 定风放飞角 ----------
console.log('== 稳定风速下的放飞角 vs 理论值 ==');
const stdLine = LINES[2]; // 二粉玻璃线
for (const windSpeed of [6, 8]) {
  for (const spec of KITES) {
    const w = new World('test', mulberry32(42));
    w.wind.steady = true;
    w.wind.base = windSpeed;
    w.wind.update(DT);
    const p = new Player(spec, stdLine, 0);
    p.len = 100;
    p.reset(theoryAngle(spec)); // 从理论角附近出发，加快收敛
    w.addPlayer(p);
    // 先飞 60 秒稳定下来
    for (let s = 0; s < 120 * 60; s++) w.step(DT);
    // 再测 30 秒平均
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
      `实测 ${avg.toFixed(2)}°  理论 ${theory.toFixed(2)}°  偏差 ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}°`,
    );
  }
}

// ---------- 2) 性能：双线 300 节点交叉判定 + 磨损 @120Hz ----------
console.log('\n== 性能：两条 300 节点的线，交叉判定+磨损，120Hz ==');
{
  const w = new World('battle', mulberry32(7));
  w.wind.base = 7;
  const p1 = new Player(KITES[0], LINES[2], 0);
  p1.len = 120;
  w.addPlayer(p1);
  const p2 = new Player(KITES[4], LINES[2], 15);
  p2.len = 120;
  w.addPlayer(p2);

  // 让 2 号来回大幅走动，两条线反复扫过对方（保证每步都有接触）
  let contactSteps = 0;
  const steps = 1200; // 10 秒
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    p2.input.walk = Math.sin(w.t * 1.2) > 0 ? -1 : 1; // 扫过 1 号的线
    p2.input.reel = Math.sin(w.t * 5) > 0 ? -1 : 0.8; // 拉锯
    p1.input.reel = Math.cos(w.t * 4) > 0 ? 0.8 : -0.8;
    w.step(DT);
    if (w.contacts.length > 0) contactSteps++;
    if (w.phase !== 'fight') break; // 线断了也算完成了磨损验证
  }
  const t1 = performance.now();
  const msPerStep = (t1 - t0) / steps;
  console.log(`  平均单步 ${msPerStep.toFixed(3)} ms（120Hz 预算 8.33ms），有接触的步数 ${contactSteps}/${steps}`);
  check('120Hz 不卡顿', msPerStep < 3, `单步 ${msPerStep.toFixed(3)}ms < 3ms`);
  check('交叉判定确实触发', contactSteps > 0, `${contactSteps} 步有接触`);

  // ---------- 3) 磨损能磨断线 ----------
  check('线被磨断', w.phase !== 'fight', `第 ${(w.t).toFixed(1)}s 断线，败者=${w.loser}`);
}

// ---------- 附加：收线爬升 / 放线下沉的方向性（看放飞角的变化） ----------
console.log('\n== 收放线手感方向 ==');
{
  const w = new World('test', mulberry32(3));
  w.wind.steady = true;
  w.wind.base = 7;
  w.wind.update(DT);
  const p = new Player(KITES[0], stdLine, 0);
  p.len = 100;
  p.reset(theoryAngle(KITES[0]));
  w.addPlayer(p);
  for (let s = 0; s < 120 * 30; s++) w.step(DT);
  const a0 = p.flightAngle();
  // 收线 3 秒：径向收线增大相对风，升力过剩，风筝应往上抢（角度冲高）
  p.input.reel = 1;
  let aMax = 0;
  for (let s = 0; s < 120 * 3; s++) { w.step(DT); aMax = Math.max(aMax, p.flightAngle()); }
  p.input.reel = 0;
  for (let s = 0; s < 120 * 10; s++) w.step(DT);
  // 放线 3 秒：张力一松，风筝应往下坐（角度走低）
  p.input.reel = -1;
  let aMin = 999;
  for (let s = 0; s < 120 * 3; s++) { w.step(DT); aMin = Math.min(aMin, p.flightAngle()); }
  p.input.reel = 0;
  check('收线爬升', aMax > a0 + 1, `稳态 ${a0.toFixed(1)}°，收线冲到 ${aMax.toFixed(1)}°`);
  check('放线下沉', aMin < a0 - 1, `稳态 ${a0.toFixed(1)}°，放线落到 ${aMin.toFixed(1)}°`);
}

// ---------- 完整对战冒烟：AI 对 AI，数值不发散、能分出胜负 ----------
console.log('\n== 完整对战冒烟 ==');
{
  const w = new World('battle', mulberry32(11));
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
  for (let s = 0; s < 120 * 180 && w.phase !== 'done'; s++) {
    ai1.update(w, p1, p2, DT);
    ai2.update(w, p2, p1, DT);
    w.step(DT);
  }
  let nan = false;
  for (const arr of [p1.x, p1.y, p2.x, p2.y]) {
    for (const v of arr) if (!Number.isFinite(v)) nan = true;
  }
  check('数值不发散', !nan, nan ? '出现 NaN/Inf' : '坐标全部有限');
  check('对局能分出胜负', w.phase === 'done', `结束于 ${w.t.toFixed(1)}s，败者=${w.loser}`);
}

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项未通过 ✗`);
process.exit(failures === 0 ? 0 : 1);
