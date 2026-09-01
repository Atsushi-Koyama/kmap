import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

type Sighting = GeoJSON.Feature<GeoJSON.Point, {
  id: string; pref: string; city: string;
  date: string | null; species: string; kind: string; note: string;
}>;
type FC = GeoJSON.FeatureCollection<GeoJSON.Point> & { generatedAt?: string };
type PrefFC = GeoJSON.FeatureCollection<GeoJSON.Geometry, { id: number; nam_ja: string; count?: number }>;

const SRC = 'sightings';
const PREF_SRC = 'prefectures';
const PREF_PT_SRC = 'pref-points';
const RISK_SRC = 'risk-mesh';
const HABITAT_SRC = 'habitat';
const DATA_URL = `${import.meta.env.BASE_URL}data/sightings.geojson`;
const META_URL = `${import.meta.env.BASE_URL}data/meta.json`;
const PREF_URL = `${import.meta.env.BASE_URL}data/prefectures.geojson`;
const PREF_PT_URL = `${import.meta.env.BASE_URL}data/pref-points.geojson`;
// 環境省「2019 クマ類全国分布メッシュ」を事前取得した静的ファイル（生息域の参考レイヤー）
const HABITAT_URL = `${import.meta.env.BASE_URL}data/habitat.geojson`;

// コロプレスの配色（0=データ未整備）
const CHORO_COLOR: maplibregl.ExpressionSpecification = ['step', ['get', 'count'],
  '#eeeae4', 1, '#fdd0a2', 500, '#fdae6b', 2000, '#f16913', 5000, '#d94801', 15000, '#8c2d04'];
// リスクメッシュの配色（2kmセルの出没件数）
const RISK_COLOR: maplibregl.ExpressionSpecification = ['step', ['get', 'count'],
  '#fef0d9', 3, '#fdcc8a', 8, '#fc8d59', 20, '#d7301f', 50, '#7f0000'];

// ---- i18n -------------------------------------------------------------------
type Dict = Record<string, string>;
const I18N: Record<string, Dict> = {
  ja: {
    title: 'クママップ', view: '表示', view_points: '出没地点（点）',
    view_risk: 'リスクマップ（2kmメッシュ）', view_pref: '県別集計（色分け）',
    pref: '都道府県', period: '期間', all: 'すべて',
    d30: '直近30日', d90: '直近90日', d365: '直近1年',
    habitat: 'クマの生息分布を表示', stats: '統計を見る',
    lg_pref: '出没件数（県別・現在の絞り込み）', lg_none: 'データ未整備',
    lg_risk: 'リスク（2kmメッシュの出没密度）',
    r1: 'わずか', r2: '低い', r3: '中', r4: '高い', r5: '非常に高い',
    by_month: '月別の出没', top_pref: '都道府県 上位', top_city: '市町村・地区 上位',
    dated: '日付あり', nodata: 'データなし',
    showing: '{n} 件を表示', updated: 'データ更新: {d}', cases: '{n} 件',
    hint: '出典: 各自治体のオープンデータ。集計は当サイト取込データに基づく値で、全都道府県を網羅するものではありません。',
    nodate: '日時不明', timeunknown: '時刻不明', risk_cell: 'このメッシュの出没', loading: '読み込み中…',
    err: 'データ取得に失敗',
  },
  en: {
    title: 'Bear Map', view: 'View', view_points: 'Sightings (points)',
    view_risk: 'Risk map (2km mesh)', view_pref: 'By prefecture (choropleth)',
    pref: 'Prefecture', period: 'Period', all: 'All',
    d30: 'Last 30 days', d90: 'Last 90 days', d365: 'Last year',
    habitat: 'Show bear habitat range', stats: 'View statistics',
    lg_pref: 'Sightings by prefecture (current filter)', lg_none: 'No data',
    lg_risk: 'Risk (sightings per 2km cell)',
    r1: 'Minimal', r2: 'Low', r3: 'Moderate', r4: 'High', r5: 'Very high',
    by_month: 'Sightings by month', top_pref: 'Top prefectures', top_city: 'Top municipalities',
    dated: 'with dates', nodata: 'No data',
    showing: '{n} sightings', updated: 'Data updated: {d}', cases: '{n} sightings',
    hint: 'Source: open data published by local governments. Figures are based on data collected by this site and do not cover all prefectures.',
    nodate: 'Date unknown', timeunknown: 'time unknown', risk_cell: 'Sightings in this cell', loading: 'Loading…',
    err: 'Failed to load data',
  },
};
let lang = (navigator.language || 'ja').startsWith('ja') ? 'ja' : 'en';

function t(key: string, vars: Record<string, string> = {}) {
  let s = I18N[lang][key] ?? I18N.ja[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

function applyLang() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n!);
  }
  langEl.value = lang;
}

// 国土地理院 淡色タイル（無料・APIキー不要）
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    // 数字ラベル用グリフ（自己ホスト・0-255範囲に数字を含む）
    glyphs: `${import.meta.env.BASE_URL}font/{fontstack}/{range}.pbf`,
    sources: {
      gsi: {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution:
          '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
        maxzoom: 18,
      },
    },
    layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
  },
  center: [137.5, 37.4],
  zoom: 4.7,
});
map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');

let all: Sighting[] = [];
let prefBase: PrefFC = { type: 'FeatureCollection', features: [] };
let prefPtBase: PrefFC = { type: 'FeatureCollection', features: [] };

// prefBase/prefPtBase に現在の絞り込み件数を付与した FC を作る
function withCounts(base: PrefFC, counts: Record<string, number>): PrefFC {
  return {
    type: 'FeatureCollection',
    features: base.features.map((f) => ({
      ...f, properties: { ...f.properties, count: counts[f.properties.nam_ja] || 0 },
    })),
  };
}
const countEl = document.getElementById('count')!;
const prefEl = document.getElementById('pref') as HTMLSelectElement;
const periodEl = document.getElementById('period') as HTMLSelectElement;
const viewEl = document.getElementById('view') as HTMLSelectElement;
const langEl = document.getElementById('lang') as HTMLSelectElement;
const habitatEl = document.getElementById('habitat') as HTMLInputElement;
const legendPrefEl = document.getElementById('legend-pref')!;
const legendRiskEl = document.getElementById('legend-risk')!;
const statsEl = document.getElementById('stats')!;

let filtered: Sighting[] = [];

function applyFilter() {
  const pref = prefEl.value;
  const days = Number(periodEl.value);
  const since = days > 0 ? Date.now() - days * 86400000 : 0;
  filtered = all.filter((f) => {
    const p = f.properties;
    if (pref && p.pref !== pref) return false;
    if (since && p.date && new Date(p.date).getTime() < since) return false;
    if (since && !p.date) return false;
    return true;
  });
  (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection', features: filtered,
  });
  // 県別集計を再計算してコロプレス（塗り）とラベル（点）へ反映
  const counts: Record<string, number> = {};
  for (const f of filtered) counts[f.properties.pref] = (counts[f.properties.pref] || 0) + 1;
  (map.getSource(PREF_SRC) as maplibregl.GeoJSONSource | undefined)?.setData(withCounts(prefBase, counts));
  (map.getSource(PREF_PT_SRC) as maplibregl.GeoJSONSource | undefined)?.setData(withCounts(prefPtBase, counts));
  (map.getSource(RISK_SRC) as maplibregl.GeoJSONSource | undefined)?.setData(buildRiskMesh(filtered));
  renderStats(filtered, counts);
  countEl.textContent = t('showing', { n: filtered.length.toLocaleString() });
}

// ---- リスクメッシュ ---------------------------------------------------------
// 出没点を約2kmのグリッドに集計する。緯度1度=約111km、経度1度=111km*cos(lat)。
const MESH_KM = 2;
const DLAT = MESH_KM / 111;

function buildRiskMesh(feats: Sighting[]): GeoJSON.FeatureCollection {
  const cells = new Map<string, { n: number; lat: number; lon: number }>();
  for (const f of feats) {
    const [lon, lat] = f.geometry.coordinates;
    const dlon = MESH_KM / (111 * Math.cos((lat * Math.PI) / 180));
    const gy = Math.floor(lat / DLAT);
    const gx = Math.floor(lon / dlon);
    const key = `${gx}:${gy}`;
    const c = cells.get(key);
    if (c) c.n++;
    else cells.set(key, { n: 1, lat: gy * DLAT, lon: gx * dlon });
  }
  const features: GeoJSON.Feature[] = [];
  for (const { n, lat, lon } of cells.values()) {
    const dlon = MESH_KM / (111 * Math.cos((lat * Math.PI) / 180));
    features.push({
      type: 'Feature',
      properties: { count: n },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [lon, lat], [lon + dlon, lat], [lon + dlon, lat + DLAT], [lon, lat + DLAT], [lon, lat],
        ]],
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ---- 統計 -------------------------------------------------------------------
function renderStats(feats: Sighting[], counts: Record<string, number>) {
  const byMonth = new Array(12).fill(0);
  const byCity: Record<string, number> = {};
  let dated = 0;
  for (const f of feats) {
    const p = f.properties;
    if (p.date) {
      // 'YYYY-MM-DD' はUTC解釈されるため、月の判定もUTCで揃える
      const d = new Date(p.date);
      byMonth[p.date.length === 10 ? d.getUTCMonth() : d.getMonth()]++;
      dated++;
    }
    const city = (p.city || '').trim();
    if (city) byCity[city] = (byCity[city] || 0) + 1;
  }
  const maxMonth = Math.max(1, ...byMonth);
  const monthBars = byMonth.map((v, i) =>
    `<div class="bar"><span class="bn">${i + 1}</span>` +
    `<span class="bv" style="width:${(v / maxMonth) * 100}%"></span>` +
    `<span class="bc">${v.toLocaleString()}</span></div>`).join('');

  const topPref = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topCity = Object.entries(byCity).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const list = (rows: [string, number][]) => rows.length
    ? rows.map(([k, v]) => `<div class="srow"><span>${esc(k)}</span><b>${v.toLocaleString()}</b></div>`).join('')
    : `<div class="srow muted">${t('nodata')}</div>`;

  statsEl.innerHTML =
    `<div class="sblock"><h4>${t('by_month')}${dated < feats.length ? `<span class="muted"> (${t('dated')}: ${dated.toLocaleString()})</span>` : ''}</h4>${monthBars}</div>` +
    `<div class="sblock"><h4>${t('top_pref')}</h4>${list(topPref)}</div>` +
    `<div class="sblock"><h4>${t('top_city')}</h4>${list(topCity)}</div>`;
}

// 表示モード切替（点 / リスク / 県別集計）
function applyView() {
  const v = viewEl.value;
  const show = (ids: string[], on: boolean) => {
    for (const id of ids) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
  };
  show(['clusters', 'cluster-count', 'points'], v === 'points');
  show(['risk-fill'], v === 'risk');
  show(['pref-fill', 'pref-line', 'pref-label'], v === 'pref');
  legendPrefEl.hidden = v !== 'pref';
  legendRiskEl.hidden = v !== 'risk';
}

async function init() {
  const [fc, meta, prefFc, prefPtFc] = await Promise.all([
    fetch(DATA_URL).then((r) => r.json() as Promise<FC>),
    fetch(META_URL).then((r) => r.json()).catch(() => null),
    fetch(PREF_URL).then((r) => r.json() as Promise<PrefFC>).catch(() => null),
    fetch(PREF_PT_URL).then((r) => r.json() as Promise<PrefFC>).catch(() => null),
  ]);
  all = fc.features as Sighting[];
  if (prefFc) prefBase = prefFc;
  if (prefPtFc) prefPtBase = prefPtFc;

  if (meta?.prefs) {
    for (const pref of meta.prefs) {
      const o = document.createElement('option');
      o.value = o.textContent = pref;
      prefEl.appendChild(o);
    }
  }
  generatedAt = fc.generatedAt || '';
  renderUpdated();

  // 生息分布（環境省メッシュ・参考レイヤー）。取得失敗しても他機能に影響させない
  fetch(HABITAT_URL).then((r) => r.json()).then((g) => {
    if (!g?.features?.length) return;
    map.addSource(HABITAT_SRC, {
      type: 'geojson', data: g,
      attribution: '生息分布: 環境省',
    });
    map.addLayer({
      id: 'habitat-fill', type: 'fill', source: HABITAT_SRC,
      layout: { visibility: habitatEl.checked ? 'visible' : 'none' },
      // メッシュ境界を描くと格子模様で埋まるため、塗りのみ・輪郭は同色で消す
      paint: {
        'fill-color': '#4e7a3f', 'fill-opacity': 0.14,
        'fill-outline-color': 'rgba(78,122,63,0.14)',
      },
    }, 'pref-fill');
  }).catch(() => { habitatEl.disabled = true; });

  // 県別コロプレス（点レイヤーより下に配置）
  map.addSource(PREF_SRC, {
    type: 'geojson', data: prefBase,
    attribution: '県境: <a href="https://github.com/dataofjapan/land" target="_blank">dataofjapan/land</a>',
  });
  map.addLayer({
    id: 'pref-fill', type: 'fill', source: PREF_SRC,
    layout: { visibility: 'none' },
    paint: { 'fill-color': CHORO_COLOR, 'fill-opacity': 0.75 },
  });
  map.addLayer({
    id: 'pref-line', type: 'line', source: PREF_SRC,
    layout: { visibility: 'none' },
    paint: { 'line-color': '#8a8a8a', 'line-width': 0.6 },
  });
  map.addSource(PREF_PT_SRC, { type: 'geojson', data: prefPtBase });
  map.addLayer({
    id: 'pref-label', type: 'symbol', source: PREF_PT_SRC,
    filter: ['>', ['get', 'count'], 0],
    layout: {
      visibility: 'none',
      'text-field': ['to-string', ['get', 'count']],
      'text-font': ['Noto Sans Regular'], 'text-size': 12,
    },
    paint: { 'text-color': '#3a2410', 'text-halo-color': '#fff', 'text-halo-width': 1.4 },
  });

  // リスクメッシュ（2kmグリッド集計）
  map.addSource(RISK_SRC, { type: 'geojson', data: buildRiskMesh(all) });
  map.addLayer({
    id: 'risk-fill', type: 'fill', source: RISK_SRC,
    layout: { visibility: 'none' },
    paint: {
      'fill-color': RISK_COLOR, 'fill-opacity': 0.72,
      'fill-outline-color': 'rgba(120,60,20,0.25)',
    },
  });

  map.addSource(SRC, {
    type: 'geojson', data: fc,
    cluster: true, clusterRadius: 50, clusterMaxZoom: 12,
  });

  map.addLayer({
    id: 'clusters', type: 'circle', source: SRC, filter: ['has', 'point_count'],
    paint: {
      'circle-color': ['step', ['get', 'point_count'], '#f1a340', 50, '#e08214', 200, '#b35806'],
      'circle-radius': ['step', ['get', 'point_count'], 16, 50, 22, 200, 30],
      'circle-opacity': 0.85,
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: SRC, filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['Noto Sans Regular'], 'text-size': 12,
    },
    paint: { 'text-color': '#fff' },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: SRC, filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': '#b35806', 'circle-radius': 6,
      'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff',
    },
  });

  map.on('click', 'clusters', (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
    const id = f.properties!.cluster_id;
    (map.getSource(SRC) as maplibregl.GeoJSONSource).getClusterExpansionZoom(id).then((z) => {
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z });
    });
  });

  map.on('click', 'points', (e) => {
    const p = (e.features![0].properties!) as Sighting['properties'];
    const geo = (e.features![0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
    // 'YYYY-MM-DD'（10文字）は時刻不明。日付だけを出す。
    // 時刻がある場合のみ JST 付きISOが入っているので時刻まで表示する。
    const loc = lang === 'ja' ? 'ja-JP' : 'en-US';
    const date = !p.date
      ? t('nodate')
      : p.date.length === 10
        ? `${new Date(p.date).toLocaleDateString(loc, { timeZone: 'UTC' })}（${t('timeunknown')}）`
        : new Date(p.date).toLocaleString(loc);
    new maplibregl.Popup({ maxWidth: '280px' })
      .setLngLat(geo)
      .setHTML(
        `<div class="popup-date">${date}</div>` +
        `<div class="popup-meta">${esc(p.pref)} ${esc(p.city)}・${esc(p.species)}</div>` +
        (p.note ? `<div class="popup-note">${esc(p.note)}</div>` : ''),
      )
      .addTo(map);
  });

  map.on('click', 'pref-fill', (e) => {
    const p = e.features![0].properties as { nam_ja: string; count?: number };
    new maplibregl.Popup({ maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup-date">${esc(p.nam_ja)}</div>` +
        `<div class="popup-meta">${t('cases', { n: (p.count || 0).toLocaleString() })}` +
        `${p.count ? '' : `（${t('lg_none')}）`}</div>`,
      )
      .addTo(map);
  });

  map.on('click', 'risk-fill', (e) => {
    const p = e.features![0].properties as { count: number };
    new maplibregl.Popup({ maxWidth: '220px' })
      .setLngLat(e.lngLat)
      .setHTML(
        `<div class="popup-date">${t('risk_cell')}</div>` +
        `<div class="popup-meta">${t('cases', { n: p.count.toLocaleString() })} / ${MESH_KM}km</div>`,
      )
      .addTo(map);
  });

  for (const layer of ['clusters', 'points', 'pref-fill', 'risk-fill']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }

  prefEl.addEventListener('change', applyFilter);
  periodEl.addEventListener('change', applyFilter);
  viewEl.addEventListener('change', applyView);
  habitatEl.addEventListener('change', () => {
    if (map.getLayer('habitat-fill')) {
      map.setLayoutProperty('habitat-fill', 'visibility', habitatEl.checked ? 'visible' : 'none');
    }
  });
  langEl.addEventListener('change', () => {
    lang = langEl.value;
    applyLang();
    renderUpdated();
    applyFilter(); // 件数表示・統計を新言語で描き直す
  });

  applyFilter(); // 初期の県別集計を反映
  applyView();   // 初期表示モード
  map.once('idle', () => { (window as unknown as { kmapReady?: boolean }).kmapReady = true; });
}

let generatedAt = '';
function renderUpdated() {
  const el = document.getElementById('updated')!;
  if (!generatedAt) { el.textContent = ''; return; }
  const d = new Date(generatedAt).toLocaleDateString(lang === 'ja' ? 'ja-JP' : 'en-US');
  el.textContent = t('updated', { d });
}

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

applyLang();
countEl.textContent = t('loading');
map.on('load', () => {
  init().catch((e) => { console.error(e); countEl.textContent = t('err'); });
});
