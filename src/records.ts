// 战绩存储（localStorage）

export interface GameRecord {
  d: string;      // 日期
  kite: string;   // 我方风筝
  line: string;   // 我方线
  foe: string;    // 对方风筝
  result: '胜' | '负';
  dur: number;    // 秒
}

export interface Records {
  wins: number;
  losses: number;
  games: GameRecord[];
}

const KEY = 'dfz_records_v1';

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = JSON.parse(raw) as Records;
      if (typeof r.wins === 'number' && Array.isArray(r.games)) return r;
    }
  } catch { /* 隐私模式等场景下读不到就算了 */ }
  return { wins: 0, losses: 0, games: [] };
}

export function saveRecord(rec: GameRecord): Records {
  const r = loadRecords();
  if (rec.result === '胜') r.wins++;
  else r.losses++;
  r.games.unshift(rec);
  if (r.games.length > 50) r.games.length = 50;
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch { /* 存不进也不影响玩 */ }
  return r;
}
