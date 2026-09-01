// ページ生成・表示で共有するデータ型とユーティリティ。
// JSON は scripts/build-pages.mjs が static/api 配下に出力したもの。

export type Rec = {
  d: string | null; // 'YYYY-MM-DD'（時刻不明）または JST付きISO
  c: string | null; // 市区町村
  k: string;        // 目撃/捕獲/人身被害 など
  s: string;        // 種（ツキノワグマ/ヒグマ）
  n: string;        // 状況の本文
  y: number;        // 緯度
  x: number;        // 経度
};

export type CityRef = { name: string; slug: string; count: number };
export type PrefIndex = { pref: string; slug: string; count: number; cities: CityRef[] };
export type Index = { generatedAt: string; total: number; prefs: PrefIndex[] };

export type Stats = {
  months: number[]; years: Record<string, number>; dated: number;
  d30: number; d365: number; peak: number; latest: string | null;
};
export type PrefPage = { pref: string; slug: string; count: number; cities: CityRef[]; stats: Stats; items: Rec[] };
export type CityPage = {
  pref: string; prefSlug: string; city: string; count: number; stats: Stats;
  items: Rec[]; points: [number, number, string | null][];
};

/** 時刻不明（'YYYY-MM-DD'）なら日付だけを返す。捏造した時刻を出さないため。 */
export function formatDate(d: string | null): string {
  if (!d) return '日時不明';
  if (d.length === 10) {
    const [y, m, day] = d.split('-');
    return `${y}年${+m}月${+day}日`;
  }
  const dt = new Date(d);
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月${dt.getDate()}日 ` +
    `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

/** 月別の件数。'YYYY-MM-DD' はUTC解釈されるため月は文字列から直接取る。 */
export function monthlyCounts(items: { d: string | null }[]): number[] {
  const m = new Array(12).fill(0);
  for (const r of items) if (r.d) m[+r.d.slice(5, 7) - 1]++;
  return m;
}

/** 直近N日の件数 */
export function recentCount(items: { d: string | null }[], days: number): number {
  const since = Date.now() - days * 86400000;
  return items.filter((r) => r.d && new Date(r.d).getTime() >= since).length;
}
