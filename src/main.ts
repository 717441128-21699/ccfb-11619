// 入口：页面管理、输入、主循环（物理 120Hz 定步长，渲染跟随 rAF）

import { World, Player, N } from './physics';
import { KITES, LINES, KiteSpec, LineSpec, theoryAngle } from './kites';
import { Renderer, HudInfo } from './render';
import { AIController } from './ai';
import { loadRecords, saveRecord } from './records';

const DT = 1 / 120;

type State = 'select' | 'test' | 'battle' | 'records';

const cv = document.getElementById('cv') as HTMLCanvasElement;
const renderer = new Renderer(cv);

let state: State = 'select';
let world: World | null = null;
let ai: AIController | null = null;
let selKite: KiteSpec = KITES[0];
let selLine: LineSpec = LINES[2]; // 默认二粉玻璃线
let aiKite: KiteSpec = KITES[4];
let matchT = 0;
let recordSaved = false;
let message = '';
let messageT = 0;

// ---------- 输入 ----------
const keys = new Set<string>();
let wheelReel = 0;

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
cv.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheelReel = Math.max(-1.5, Math.min(1.5, wheelReel - Math.sign(e.deltaY) * 0.7));
}, { passive: false });

function readInput(): { reel: number; walk: number } {
  let reel = 0, walk = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) reel += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) reel -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) walk -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) walk += 1;
  reel += wheelReel;
  return { reel: Math.max(-1, Math.min(1, reel)), walk };
}

// ---------- 页面 DOM ----------
const $ = (id: string) => document.getElementById(id)!;

function showPage(name: State): void {
  state = name;
  $('page-select').hidden = name !== 'select';
  $('page-records').hidden = name !== 'records';
  $('btn-exit').hidden = !(name === 'test' || name === 'battle');
  if (name !== 'battle') $('overlay-result').hidden = true;
}

function statBar(label: string, v: number, max: number): string {
  const pct = Math.round((v / max) * 100);
  return `<div class="stat"><span>${label}</span><span>${v}</span></div><div class="bar"><i style="width:${pct}%"></i></div>`;
}

function buildSelectPage(): void {
  const kl = $('kite-list');
  kl.innerHTML = '';
  for (const k of KITES) {
    const ld = (k.cl / k.cd).toFixed(1);
    const el = document.createElement('div');
    el.className = 'card' + (k === selKite ? ' sel' : '');
    el.innerHTML =
      `<div class="swatch" style="background:${k.color};border:3px solid ${k.accent}"></div>` +
      `<h3>${k.name}</h3><div class="origin">${k.origin}</div>` +
      `<div class="desc">${k.desc}</div>` +
      statBar('升阻比', +ld, 6) +
      statBar('体重', k.mass, 1) +
      statBar('翼面', k.area, 1);
    el.onclick = () => { selKite = k; buildSelectPage(); };
    kl.appendChild(el);
  }
  const ll = $('line-list');
  ll.innerHTML = '';
  for (const l of LINES) {
    const el = document.createElement('div');
    el.className = 'card' + (l === selLine ? ' sel' : '');
    el.innerHTML =
      `<div class="swatch" style="background:${l.color}"></div>` +
      `<h3>${l.name}</h3><div class="origin">玻璃粉 ${'★'.repeat(l.glass) || '无'}</div>` +
      `<div class="desc">${l.desc}</div>` +
      statBar('锋利', l.wearFactor, 2.5) +
      statBar('耐磨', l.strength, 1.8);
    el.onclick = () => { selLine = l; buildSelectPage(); };
    ll.appendChild(el);
  }
}

function buildRecordsPage(): void {
  const r = loadRecords();
  $('records-summary').textContent =
    `共 ${r.wins + r.losses} 场 —— 胜 ${r.wins} / 负 ${r.losses}` +
    (r.wins + r.losses > 0 ? `，胜率 ${Math.round((r.wins / (r.wins + r.losses)) * 100)}%` : '');
  const tb = $('records-table').querySelector('tbody')!;
  tb.innerHTML = '';
  for (const g of r.games) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${g.d}</td><td>${g.kite}</td><td>${g.line}</td><td>${g.foe}</td>` +
      `<td class="${g.result === '胜' ? 'win' : 'lose'}">${g.result}</td><td>${g.dur.toFixed(0)}s</td>`;
    tb.appendChild(tr);
  }
  if (r.games.length === 0) {
    tb.innerHTML = '<tr><td colspan="6">还没有战绩，去斗一场吧</td></tr>';
  }
}

// ---------- 开局 ----------
function makeWorld(mode: 'test' | 'battle'): World {
  const w = new World(mode);
  w.wind.base = 5.5 + Math.random() * 2.5;
  const me = new Player(selKite, selLine, mode === 'battle' ? -12 : 0);
  me.len = 70;
  me.reset(theoryAngle(selKite));
  w.addPlayer(me);
  if (mode === 'battle') {
    aiKite = KITES[Math.floor(Math.random() * KITES.length)];
    const foe = new Player(aiKite, LINES[2], 12);
    foe.len = 70;
    foe.reset(theoryAngle(aiKite));
    w.addPlayer(foe);
    ai = new AIController(1);
  }
  return w;
}

function startTest(): void {
  world = makeWorld('test');
  angleBuf.length = 0;
  message = '';
  showPage('test');
}

function startBattle(): void {
  world = makeWorld('battle');
  matchT = 0;
  recordSaved = false;
  message = '斗！';
  messageT = 1.5;
  showPage('battle');
}

function endBattle(): void {
  if (!world || recordSaved) return;
  recordSaved = true;
  const iWon = world.loser === 1;
  saveRecord({
    d: new Date().toLocaleDateString('zh-CN'),
    kite: selKite.name,
    line: selLine.name,
    foe: aiKite.name,
    result: iWon ? '胜' : '负',
    dur: matchT,
  });
  $('result-title').textContent = iWon ? '赢了！' : '线断了……';
  $('result-title').style.color = iWon ? '#8fe08f' : '#e88a7a';
  $('result-detail').textContent = iWon
    ? `对方的${aiKite.name}断线飘走了，用时 ${matchT.toFixed(0)} 秒。`
    : `你的${selKite.name}断线飘走了，用时 ${matchT.toFixed(0)} 秒。`;
  $('overlay-result').hidden = false;
}

// ---------- 按钮 ----------
$('btn-test').onclick = startTest;
$('btn-battle').onclick = startBattle;
$('btn-records').onclick = () => { buildRecordsPage(); showPage('records'); };
$('btn-records-back').onclick = () => showPage('select');
$('btn-exit').onclick = () => { world = null; showPage('select'); };
$('btn-again').onclick = () => { $('overlay-result').hidden = true; startBattle(); };
$('btn-back-select').onclick = () => { world = null; showPage('select'); };
window.addEventListener('resize', () => renderer.resize());

// ---------- 主循环 ----------
const angleBuf: number[] = [];
let last = performance.now();
let acc = 0;
let tGlobal = 0;

function frame(now: number): void {
  let dt = (now - last) / 1000;
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
  if (n === 8) acc = 0; // 卡顿时丢帧保渲染

  // 滚轮收放的脉冲衰减
  wheelReel *= Math.pow(0.02, dt);
  if (Math.abs(wheelReel) < 0.02) wheelReel = 0;

  let hud: HudInfo | null = null;
  if (world && (state === 'test' || state === 'battle')) {
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
      message: messageT > 0 ? message : undefined,
    };
    if (state === 'battle' && world.phase === 'done') endBattle();
    if (state === 'battle' && world.phase === 'broken' && world.loser >= 0) {
      hud.message = world.loser === 0 ? '我方线断！' : '对方线断！';
    }
  }
  renderer.render(world, hud, dt, tGlobal);
  requestAnimationFrame(frame);
}

function step(dt: number): void {
  if (!world || (state !== 'test' && state !== 'battle')) return;
  const me = world.players[0];
  if (world.phase === 'fight') {
    const inp = readInput();
    me.input.reel = inp.reel;
    me.input.walk = inp.walk;
  } else {
    me.input.reel = 0;
    me.input.walk = 0;
  }
  if (state === 'battle' && world.players.length === 2 && ai) {
    ai.update(world, world.players[1], me, dt);
    matchT += dt;
  }
  world.step(dt);
}

buildSelectPage();
showPage('select');
requestAnimationFrame(frame);
