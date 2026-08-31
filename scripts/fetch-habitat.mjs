#!/usr/bin/env node
// 環境省「2019 クマ類全国分布メッシュ」(5kmメッシュ) を取得し、
// 生息域ポリゴンを public/data/habitat.geojson に保存する。
// 出没点とは別の「生息分布」参考レイヤー。実行: node scripts/fetch-habitat.mjs

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const BASE = 'https://svr-moej.gisservice.jp/arcgis/rest/services/Hosted/bear2019_5k/FeatureServer/0';
const PAGE = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPage(offset) {
  const u = `${BASE}/query?where=1%3D1&outFields=&f=geojson&resultRecordCount=${PAGE}&resultOffset=${offset}`;
  for (let i = 0; i < 4; i++) {
    if (i) await sleep(2000 * i);
    try {
      const res = await fetch(u, { headers: { 'User-Agent': 'kmap-etl/0.1' } });
      if (res.ok) return (await res.json()).features || [];
    } catch { /* リトライ */ }
  }
  throw new Error(`page ${offset} 取得失敗`);
}

// 座標を3桁(約100m)に丸める。5kmメッシュにはこれで十分
const r3 = (n) => Math.round(n * 1e3) / 1e3;
const roundRing = (ring) => ring.map(([x, y]) => [r3(x), r3(y)]);

async function main() {
  const features = [];
  for (let offset = 0; ; offset += PAGE) {
    process.stdout.write(`取得中: offset=${offset} ... `);
    const page = await getPage(offset);
    console.log(`${page.length} 件`);
    for (const f of page) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === 'Polygon') g.coordinates = g.coordinates.map(roundRing);
      else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map((p) => p.map(roundRing));
      features.push({ type: 'Feature', geometry: g, properties: {} });
    }
    if (page.length < PAGE) break;
  }

  await mkdir(OUT_DIR, { recursive: true });
  const fc = { type: 'FeatureCollection', features };
  await writeFile(join(OUT_DIR, 'habitat.geojson'), JSON.stringify(fc));
  console.log(`\n生息メッシュ ${features.length} 件 → public/data/habitat.geojson`);
}

main().catch((e) => { console.error(e); process.exit(1); });
