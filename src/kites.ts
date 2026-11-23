// 风筝与线的参数表 —— 按几种地方风筝的脾气编的数据

export interface KiteSpec {
  id: string;
  name: string;
  origin: string;
  desc: string;
  area: number;   // 面积 m²
  mass: number;   // 质量 kg
  cl: number;     // 升力系数
  cd: number;     // 阻力系数
  shape: 'shayan' | 'yingchi' | 'banyao' | 'hudie' | 'dou';
  color: string;
  accent: string;
}

export const KITES: KiteSpec[] = [
  {
    id: 'shayan', name: '沙燕', origin: '北京',
    desc: '北京硬翅沙燕，升力足、性子稳，正经的看家风筝。',
    area: 0.45, mass: 0.15, cl: 0.92, cd: 0.19,
    shape: 'shayan', color: '#2c6fbb', accent: '#e8442e',
  },
  {
    id: 'yingchi', name: '硬翅仕女', origin: '潍坊',
    desc: '潍坊硬翅，架子硬朗，风大才放得开，压得住阵脚。',
    area: 0.62, mass: 0.24, cl: 0.86, cd: 0.21,
    shape: 'yingchi', color: '#c23a8e', accent: '#f5d020',
  },
  {
    id: 'banyao', name: '板鹞', origin: '南通',
    desc: '南通板鹞，哨口成风。块头大、拉力横，慢但是沉。',
    area: 0.95, mass: 0.28, cl: 0.76, cd: 0.26,
    shape: 'banyao', color: '#d9822b', accent: '#203a8f',
  },
  {
    id: 'hudie', name: '软翅蝴蝶', origin: '天津',
    desc: '天津软翅，翅子活泛，身轻如叶，风一变它先知道。',
    area: 0.4, mass: 0.12, cl: 0.98, cd: 0.23,
    shape: 'hudie', color: '#7a3fc9', accent: '#ffd166',
  },
  {
    id: 'douzheng', name: '打斗风筝', origin: '阳江',
    desc: '广东打斗筝，小快灵，专为割线而生，配玻璃线最凶。',
    area: 0.3, mass: 0.09, cl: 0.7, cd: 0.15,
    shape: 'dou', color: '#e8e3d8', accent: '#c0392b',
  },
];

export interface LineSpec {
  id: string;
  name: string;
  glass: number;      // 玻璃粉等级 0~3
  wearFactor: number; // 割别人线的能力
  strength: number;   // 自身耐磨（耐久条长度）
  density: number;    // 线密度 kg/m
  diameter: number;   // 线径 m
  color: string;
  desc: string;
}

export const LINES: LineSpec[] = [
  {
    id: 'cotton', name: '棉线', glass: 0,
    wearFactor: 0.5, strength: 1.7, density: 0.0002, diameter: 0.00022,
    color: '#e8e0c8', desc: '结实耐磨，就是咬不动别人的线。',
  },
  {
    id: 'glass1', name: '一粉玻璃线', glass: 1,
    wearFactor: 1.0, strength: 1.25, density: 0.00017, diameter: 0.00019,
    color: '#d8e6c8', desc: '薄薄一层玻璃粉，攻守都沾一点。',
  },
  {
    id: 'glass2', name: '二粉玻璃线', glass: 2,
    wearFactor: 1.6, strength: 0.95, density: 0.00016, diameter: 0.00018,
    color: '#c8d8e8', desc: '老玩家的标配，割得动也扛得住。',
  },
  {
    id: 'glass3', name: '三粉玻璃线', glass: 3,
    wearFactor: 2.4, strength: 0.7, density: 0.00015, diameter: 0.00017,
    color: '#e8c8c8', desc: '满口玻璃碴，割人快，自己也脆。',
  },
];

/** 理论放飞角：线重不计时 tanθ = 升阻比 */
export function theoryAngle(spec: KiteSpec): number {
  return (Math.atan(spec.cl / spec.cd) * 180) / Math.PI;
}
