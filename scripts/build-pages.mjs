#!/usr/bin/env node
// sightings.geojson を「ページ単位」に分割する。
// 全ページで30MBを読ませないための前処理で、SEO用の地域ページの元にもなる。
// 出力:
//   static/api/index.json              都道府県・市区町村の一覧と件数（ページ生成用）
//   static/api/points.geojson          全国地図用の全点（座標のみのGeoJSON）
//   static/api/pref/<slug>.json        都道府県ページのデータ
//   static/api/city/<pref>-<slug>.json 市区町村ページのデータ
// 実行: node scripts/build-pages.mjs

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data', 'sightings.geojson');
const OUT = join(__dirname, '..', 'static', 'api');

// 都道府県 → URLスラッグ（kumamap と同じローマ字表記に合わせる）
const PREF_SLUG = {
  北海道: 'hokkaido', 青森県: 'aomori', 岩手県: 'iwate', 宮城県: 'miyagi',
  秋田県: 'akita', 山形県: 'yamagata', 福島県: 'fukushima', 茨城県: 'ibaraki',
  栃木県: 'tochigi', 群馬県: 'gunma', 埼玉県: 'saitama', 千葉県: 'chiba',
  東京都: 'tokyo', 神奈川県: 'kanagawa', 新潟県: 'niigata', 富山県: 'toyama',
  石川県: 'ishikawa', 福井県: 'fukui', 山梨県: 'yamanashi', 長野県: 'nagano',
  岐阜県: 'gifu', 静岡県: 'shizuoka', 愛知県: 'aichi', 三重県: 'mie',
  滋賀県: 'shiga', 京都府: 'kyoto', 大阪府: 'osaka', 兵庫県: 'hyogo',
  奈良県: 'nara', 和歌山県: 'wakayama', 鳥取県: 'tottori', 島根県: 'shimane',
  岡山県: 'okayama', 広島県: 'hiroshima', 山口県: 'yamaguchi', 徳島県: 'tokushima',
  香川県: 'kagawa', 愛媛県: 'ehime', 高知県: 'kochi', 福岡県: 'fukuoka',
  佐賀県: 'saga', 長崎県: 'nagasaki', 熊本県: 'kumamoto', 大分県: 'oita',
  宮崎県: 'miyazaki', 鹿児島県: 'kagoshima', 沖縄県: 'okinawa',
};

// 市区町村名を city / note から抜き出す。「◯◯市◯◯町」のような連結は先頭の自治体だけ取る
const CITY_RE = /([一-龥ぁ-んァ-ヶー]{1,8}?[市区町村])/;
function cityOf(p) {
  for (const src of [p.city, p.note]) {
    const m = CITY_RE.exec(String(src || ''));
    if (m) return m[1];
  }
  return null;
}

// 市区町村名 → スラッグ。日本語のままURLに入れると可読性が落ちるため連番を併用する
const citySlug = (pref, city, seq) => `${PREF_SLUG[pref] || 'jp'}-${seq}`;

const round = (n, d = 5) => Math.round(n * 10 ** d) / 10 ** d;

// 統計は必ず「全件」から計算する。表示用に間引いた配列から出すと数字が嘘になる。
function summarize(recs) {
  const months = new Array(12).fill(0);
  const years = {};
  let dated = 0;
  const now = Date.now();
  let d30 = 0, d365 = 0;
  for (const r of recs) {
    if (!r.d) continue;
    dated++;
    months[+r.d.slice(5, 7) - 1]++;
    const y = r.d.slice(0, 4);
    years[y] = (years[y] || 0) + 1;
    const t = new Date(r.d).getTime();
    if (now - t <= 30 * 86400000) d30++;
    if (now - t <= 365 * 86400000) d365++;
  }
  const peak = months.indexOf(Math.max(...months)) + 1;
  const latest = recs.find((r) => r.d)?.d || null;
  return { months, years, dated, d30, d365, peak, latest };
}

async function main() {
  const fc = JSON.parse(await readFile(DATA, 'utf8'));
  const feats = fc.features;
  console.log(`読み込み: ${feats.length.toLocaleString()} 件`);

  // 県 → 市区町村 → レコード
  const byPref = new Map();
  for (const f of feats) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const rec = {
      d: p.date || null,
      pref: p.pref || '',
      c: cityOf(p),
      k: p.kind || '',
      s: p.species || '',
      n: (p.note || '').slice(0, 140),
      y: round(lat),
      x: round(lon),
    };
    if (!byPref.has(p.pref)) byPref.set(p.pref, []);
    byPref.get(p.pref).push(rec);
  }

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'pref'), { recursive: true });
  await mkdir(join(OUT, 'city'), { recursive: true });

  const index = { generatedAt: fc.generatedAt, total: feats.length, prefs: [] };
  // 市区町村ページは件数が十分なものだけ作る（中身の薄いページを量産しないため）
  const CITY_MIN = 20;

  for (const [pref, recs] of [...byPref.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const slug = PREF_SLUG[pref];
    if (!slug) { console.log(`  スラッグ未定義のためスキップ: ${pref}`); continue; }
    recs.sort((a, b) => (b.d || '').localeCompare(a.d || ''));

    const cityCount = new Map();
    for (const r of recs) if (r.c) cityCount.set(r.c, (cityCount.get(r.c) || 0) + 1);

    const cities = [];
    let seq = 0;
    for (const [name, n] of [...cityCount.entries()].sort((a, b) => b[1] - a[1])) {
      if (n < CITY_MIN) continue;
      const cslug = citySlug(pref, name, ++seq);
      cities.push({ name, slug: cslug, count: n });
      const rows = recs.filter((r) => r.c === name);
      await writeFile(join(OUT, 'city', `${cslug}.json`),
        JSON.stringify({ pref, prefSlug: slug, city: name, count: n,
          stats: summarize(rows), items: rows.slice(0, 500),
          points: rows.map((r) => [r.x, r.y, r.d ? r.d.slice(0, 7) : null]) }));
    }

    // 県ページ本体は最新500件だけ（一覧表示用）。地図用の全点は座標のみの別ファイルにする
    await writeFile(join(OUT, 'pref', `${slug}.json`),
      JSON.stringify({ pref, slug, count: recs.length, cities,
        stats: summarize(recs), items: recs.slice(0, 500) }));
    await writeFile(join(OUT, 'pref', `${slug}-points.json`),
      JSON.stringify(recs.map((r) => [r.x, r.y, r.d ? r.d.slice(0, 7) : null])));
    index.prefs.push({ pref, slug, count: recs.length, cities: cities.map(({ name, slug: s, count }) => ({ name, slug: s, count })) });
  }

  await writeFile(join(OUT, 'index.json'), JSON.stringify(index));

  // 全国地図用。元の sightings.geojson は 30MB あり Cloudflare Pages の 25MiB 制限を超えるので、
  // ポップアップに必要な properties だけを短いキーで残した GeoJSON を出す。
  // MapLibre には「オブジェクト」ではなく「URL」で渡すこと。URL ならワーカー側で
  // fetch・パース・クラスタリングが走り、10万点でもメインスレッドが固まらない。
  const allPoints = [];
  for (const recs of byPref.values()) {
    for (const r of recs) {
      allPoints.push(JSON.stringify({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.x, r.y] },
        properties: { d: r.d, p: r.pref, c: r.c, n: r.n.slice(0, 100) },
      }));
    }
  }
  await writeFile(join(OUT, 'points.geojson'),
    `{"type":"FeatureCollection","features":[${allPoints.join(',')}]}`);

  const cityTotal = index.prefs.reduce((a, p) => a + p.cities.length, 0);
  console.log(`都道府県ページ: ${index.prefs.length}`);
  console.log(`市区町村ページ: ${cityTotal}（${CITY_MIN}件以上）`);
  console.log(`全国地図の点: ${allPoints.length.toLocaleString()}`);
  console.log(`→ ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
