#!/usr/bin/env node
// 一次ソース（自治体オープンデータ）からクマ出没情報を取得し、
// 共通スキーマの GeoJSON (public/data/sightings.geojson) に正規化する ETL。
// 実行: node scripts/fetch-data.mjs
//
// 対応ソース種別:
//   csv    ... CSV をパース（encoding指定可）。map(row) が lat/lon を返す
//   arcgis ... ArcGIS FeatureServer を GeoJSON でページ取得。座標はGeometryから
//   kml    ... Google My Maps 等の KML(forcekml)。Placemarkから座標抽出
//   shpzip ... Shapefile(zip)。shpjsで解析、proj指定時はproj4で座標変換
//   json/geojson/htmljson ... API・静的GeoJSON・HTML埋め込みJSON
//   custom ... 独自の取得関数 fetch() を持つ（複数リクエストが要る場合）
// 新しい県は SOURCES に1件足すだけ。

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import shp from 'shpjs';
import proj4 from 'proj4';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');

// 平面直角座標系 第VII系（岐阜など）JGD2011 EPSG:6675
const JPRCS_VII = '+proj=tmerc +lat_0=36 +lon_0=137.166666666667 +k=0.9999 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs';

// ---- データソース定義 -------------------------------------------------------
const SOURCES = [
  // 既存
  {
    name: '秋田県クマダス', pref: '秋田県', type: 'csv',
    url: 'https://ckan.pref.akita.lg.jp/dataset/f801a10f-f076-47e4-b5a6-0bb5569639e0/resource/0678f9b3-4bf7-4212-9c0e-c0cb9b09b3cf/download/050008_kumadas.csv',
    map: (r) => ({
      id: `akita-${r['出没情報ID']}`, pref: '秋田県', city: r['市町村'] || '',
      date: parseDate(r['目撃日時']), species: r['獣種'] || '', kind: r['情報種別'] || '',
      note: r['目撃時の状況'] || '', lat: num(r['x(緯度)']), lon: num(r['y(経度)']),
    }),
  },
  ...sapporoYears([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]),
  {
    name: '富山県クマっぷ', pref: '富山県', type: 'arcgis', pageSize: 1000,
    url: 'https://services7.arcgis.com/pUdPpUsq83Kw8pWi/arcgis/rest/services/survey123_3f07f1f9864d43368d48b5f373d6cd68_results/FeatureServer/0',
    map: (r) => ({
      id: `toyama-${r.objectid ?? r.globalid}`, pref: '富山県', city: r.HasseiCity || '',
      date: parseDate(r.HasseiDateTime), species: 'ツキノワグマ', kind: r.HoukokuType || '',
      note: [r.HasseiArea, r.TsuhoInfo].filter(Boolean).join(' '),
    }),
  },
  {
    name: '新潟県クマ出没報告(2017-2024)', pref: '新潟県', type: 'arcgis', pageSize: 2000,
    url: 'https://services6.arcgis.com/SKz58fvdFlaEB35q/arcgis/rest/services/2017_2024%E3%82%AF%E3%83%9E%E5%87%BA%E6%B2%A1%E5%A0%B1%E5%91%8A/FeatureServer/0',
    map: (r, i) => ({
      id: `niigata-${r.FID ?? i}`, pref: '新潟県', city: r['市町村名'] || '',
      date: parseDate(`${r['目撃_出没__月日'] || ''} ${r['目撃_出没___時間'] || ''}`.trim()),
      species: 'ツキノワグマ', kind: r['区分'] || '',
      note: [r['目撃_出没_地区'], r['目撃_出没_時の状況']].filter(Boolean).join(' '),
    }),
  },

  {
    name: '新潟県クマ出没(R7-R8)', pref: '新潟県', type: 'arcgis', pageSize: 1000,
    url: 'https://services6.arcgis.com/SKz58fvdFlaEB35q/arcgis/rest/services/survey123_08d14b98657b47309b868f49602375c8/FeatureServer/0',
    map: (r) => ({
      id: `niigata-s123-${r.objectid}`, pref: '新潟県', city: r.field_7 || '',
      date: parseDate(r.field_20), species: 'ツキノワグマ', kind: r.field_8 || '目撃',
      note: r.field_9 || '',
    }),
  },
  {
    name: '新潟県クマ人身被害(R2-R8)', pref: '新潟県', type: 'arcgis', pageSize: 1000,
    url: 'https://services6.arcgis.com/SKz58fvdFlaEB35q/arcgis/rest/services/クマ人身被害発生地点（年度込み）/FeatureServer/0',
    map: (r, i) => ({
      id: `niigata-injury-${r.objectid ?? i}`, pref: '新潟県', city: '',
      date: parseDate(r['年月日']), species: 'ツキノワグマ', kind: '人身被害',
      note: '人身被害',
    }),
  },

  // 追加: ArcGIS FeatureServer
  {
    name: '福島県クマ目撃', pref: '福島県', type: 'arcgis', pageSize: 2000,
    url: 'https://services6.arcgis.com/M9nrgnB1gu8YnLFM/arcgis/rest/services/福島県クマ目撃ポイントレイヤー_202606_view/FeatureServer/0',
    map: (r) => ({
      id: `fukushima-${r.objectid}`, pref: '福島県', city: r.address_public || '',
      date: parseDate(r.kuma_date), species: 'ツキノワグマ', kind: r.sighting || '',
      note: r.detail_sighting_public || '',
    }),
  },
  {
    name: '群馬県クマ出没', pref: '群馬県', type: 'arcgis', pageSize: 2000,
    url: 'https://services7.arcgis.com/DkC6f6v0YUQX0rke/arcgis/rest/services/survey123_a77f33a9b9f649cfada5c7983c67874b_results/FeatureServer/0',
    map: (r) => ({
      id: `gunma-${r.objectid}`, pref: '群馬県', city: r.field_11 || '',
      date: parseDate(r.field_18), species: 'ツキノワグマ', kind: '目撃',
      note: [r.field_11, r.field_19].filter(Boolean).join(' '),
    }),
  },
  {
    name: '埼玉県クマ出没', pref: '埼玉県', type: 'arcgis', pageSize: 2000,
    url: 'https://services9.arcgis.com/n65w8AXGaYPTqFYI/arcgis/rest/services/survey123_3123e5ed452d4e89845e4ba6129c1e2d_results/FeatureServer/0',
    map: (r) => ({
      id: `saitama-${r.objectid}`, pref: '埼玉県', city: r.field_4 || '',
      date: parseDate(r.field_1), species: 'ツキノワグマ', kind: '目撃',
      note: r.field_9 || r.field_6 || '',
    }),
  },
  {
    name: '奈良県クマ', pref: '奈良県', type: 'arcgis', pageSize: 2000,
    url: 'https://pub-gis.nsa.pref.nara.jp/server/rest/services/Hosted/survey123_492ede82f5ae450ea7171fb986f04bd0_results/FeatureServer/0',
    map: (r) => ({
      id: `nara-${r.objectid}`, pref: '奈良県', city: r.field_6 || '',
      date: parseDate(r.field_9), species: 'ツキノワグマ', kind: r.field_4 || '',
      note: [r.field_7, r.field_11].filter(Boolean).join(' '),
    }),
  },
  {
    name: '奈良県クマ(別フォーム)', pref: '奈良県', type: 'arcgis', pageSize: 1000,
    url: 'https://pub-gis.nsa.pref.nara.jp/server/rest/services/Hosted/survey123_06dcaaa88f124b5cbb7363230dded157/FeatureServer/0',
    map: (r) => ({
      id: `nara2-${r.objectid}`, pref: '奈良県', city: '',
      date: parseDate(r.field_6), species: 'ツキノワグマ', kind: r.field_1 || '目撃',
      note: r.field_9 || '',
    }),
  },
  {
    name: '三重県クマ目撃', pref: '三重県', type: 'arcgis', pageSize: 2000,
    url: 'https://services5.arcgis.com/tkvkIlp1M2KOKx34/arcgis/rest/services/（R6確定版）クマ目撃位置情報（提供用）/FeatureServer/0',
    map: (r) => ({
      id: `mie-${r.OID ?? r.ObjectId}`, pref: '三重県', city: r['場所'] || '',
      date: parseDate(r['目撃日']), species: 'ツキノワグマ', kind: r['発見形態'] || '',
      note: r['場所'] || '',
    }),
  },

  // 追加: CKAN / CSV
  {
    name: '京都府クマ出没(BODIK)', pref: '京都府', type: 'csv',
    url: 'https://data.bodik.jp/dataset/e40b887d-0212-4ad5-8cf8-4ae3a2b5f4dd/resource/5eb145e6-5b3f-489d-a991-3d2da42c109b/download/260002bearfy.csv',
    map: (r, i) => ({
      id: `kyoto-${i}`, pref: '京都府', city: r['市町村名'] || '',
      date: parseDate(r['目撃年月日']), species: 'ツキノワグマ', kind: '目撃',
      note: [r['観察場所'], r['目撃時の状況']].filter(Boolean).join(' '),
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  },
  // 山口 YPくまっぷ 2023-2026（すべて Shift_JIS・同一ヘッダ）
  ...yamaguchiYears(),
  {
    name: '石川県クマ目撃(R7)', pref: '石川県', type: 'csv',
    url: 'https://ckan.opendata.pref.ishikawa.lg.jp/dataset/2dfb05eb-b7c0-4285-a033-f21674c5cfe5/resource/7584d555-e1f8-4639-b62d-919445970236/download/bear_sightings_r7.csv',
    map: (r, i) => ({
      id: `ishikawa-r7-${r['番号'] || i}`, pref: '石川県', city: r['市町名'] || '',
      date: parseDate(r['出没日']), species: 'ツキノワグマ', kind: '目撃',
      note: [r['場所'], r['備考']].filter(Boolean).join(' '),
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  },
  // 石川 R1〜R6 分析マップ（要因別に5本。重複除去で統合される）
  ...ishikawaR16(),

  // 追加: Google My Maps (KML)
  kmlSrc('宮城県', '宮城県クマ目撃', '1aZCXqs7vrAPEBhE4HkT3CwmlMdunP2Y'),
  kmlSrc('山形県', '山形県クマ目撃', '1N9E9rixBQwxB4TKQ2XsP32GLOi6w6qQ'),
  kmlSrc('静岡県', '静岡県クマ目撃(R8)', '1o_iXJ5z-tA9bTd8k2DMFPLO9BS4LRDI'),
  kmlSrc('静岡県', '静岡県クマ目撃(R7)', '1hwFI-xmiB1uYeEpfNetfP15CS9uxo08'),
  kmlSrc('岡山県', '岡山県クマ目撃', '1y64vgpv0Yc6srgFeVC5ZkJf37kNuuKI'),

  // 追加: Shapefile(zip) + 座標変換（岐阜は H26〜R7 の全年度）
  ...gifuYears(),

  // 追加: JSON配列（独自API・県警オープンデータ）
  {
    name: '兵庫県警安全安心マップ(熊)', pref: '兵庫県', type: 'json',
    url: 'https://map.police.hyogo.dsvc.jp/data/json/mail.json',
    array: (d) => (Array.isArray(d) ? d : []),
    map: (r) => {
      const bear = r.category === '動物' && /熊|クマ/.test(r.title || '');
      return {
        id: `hyogo-${r.id}`, pref: '兵庫県', city: r.sender || '',
        date: parseDate(r.send_at), species: bear ? 'ツキノワグマ' : '', kind: '目撃',
        note: (r.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        lat: num(r.latitude), lon: num(r.longitude),
      };
    },
  },
  {
    name: '青森県くまログ', pref: '青森県', type: 'json',
    url: 'https://kumalog-aomori.info/api/ver1/sightings/post_list_external',
    array: (d) => d.result || [],
    map: (r, i) => ({
      id: `aomori-${r.id ?? i}`, pref: '青森県', city: r.municipality_name || '',
      date: parseDate(r.sighting_datetime), species: r.animal_species_name || 'ツキノワグマ',
      kind: r.info_type_name || '目撃', note: r.address || '',
      lat: num(r.latitude), lon: num(r.longitude),
    }),
  },

  // 追加: 静的GeoJSON（鳥取・年度別）
  ...tottoriYears(['H30', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7']),

  // 長野県警・新潟県警の事件事故マップ 動物TSV（Content-Encoding: gzip で配信）。
  // 県全域・日次更新だが直近12ヶ月のローリングなので、アーカイブ統合で履歴を積む。
  // ※ 栃木県警は /data/map/*.tsv.gz、長野・新潟は /data/tsv/animal_full.tsv と経路が違う
  {
    name: '長野県警 動物出没(熊)', pref: '長野県', type: 'tsv',
    url: 'https://map.police.nagano.dsvc.jp/data/tsv/animal_full.tsv',
    map: (r, i) => ({
      id: `nagano-police-${r[0] || i}`, pref: '長野県', city: r[5] || '',
      date: parseDate(`${r[15] || ''} ${r[16] || ''}`.trim()),
      species: r[9] || '', kind: '目撃',
      note: (r[10] || r[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      lat: num(r[6]), lon: num(r[7]),
    }),
  },
  {
    name: '新潟県警 動物出没(クマ)', pref: '新潟県', type: 'tsv',
    url: 'https://map.police.niigata.dsvc.jp/data/tsv/animal_full.tsv',
    map: (r, i) => ({
      id: `niigata-police-${r[0] || i}`, pref: '新潟県', city: r[6] || '',
      date: parseDate(`${r[18] || ''} ${r[19] || ''}`.trim()),
      species: r[11] || '', kind: '目撃',
      note: (r[12] || r[2] || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      lat: num(r[7]), lon: num(r[8]),
    }),
  },

  // 飯田市「いいだWebまっぷ」(GeoCloud)。年度別レイヤ。県警TSVは直近12ヶ月のみなので過年度分を補う。
  // Referer とブラウザUAが無いと403になる
  iidaLayer('R8', 0), iidaLayer('R7', 2),

  // 諏訪地域の市町村（県警TSVは直近12ヶ月のみなので過年度分を補う）
  {
    name: '岡谷市クマ出没', pref: '長野県', type: 'arcgis', pageSize: 1000,
    url: 'https://services1.arcgis.com/4GMefrLcjv8z16wh/arcgis/rest/services/クマ出没マップ/FeatureServer/0',
    map: (r, i) => ({
      id: `okaya-${r.OBJECTID ?? r.objectid ?? i}`, pref: '長野県', city: '岡谷市',
      date: parseDate(r['日付'] || r['年度']), species: r['鳥獣'] || 'ツキノワグマ',
      kind: r['分類'] || '目撃', note: [r['場所'], r['状況']].filter(Boolean).join(' '),
    }),
  },
  kmlSrc('長野県', '茅野市クマ目撃(R8)', '1nMKi0qK-fG6MVSGZHX82mzDLmXmZJSI'),
  kmlSrc('長野県', '茅野市クマ目撃(R7)', '1lWEbYwo8Rjnu5k8bzud5TOgpzgWiRaw'),
  kmlSrc('長野県', '茅野市クマ目撃(R6)', '1A1QqRnefVvLj5UbmaQBvlZ69TadIXZE'),
  kmlSrc('長野県', '茅野市クマ目撃(R5)', '1ZRtRySw-apeqjSuH19xeaQxyo1k1leQ'),
  kmlSrc('長野県', '富士見町クマ出没(R8)', '1FeFnrW_VegLPAKUKQ17eb-DDVYEXZq4'),
  kmlSrc('長野県', '富士見町クマ出没(R7)', '1vWM8FSdhp16WKcrNfCYJ2KGJpz8bwfw'),
  kmlSrc('長野県', '原村クマ出没(R8)', '1PuemOr6Cw73KM_Y7Uz_0DWLrCA86iRw'),
  kmlSrc('長野県', '原村クマ出没(R7)', '1V-4TVY3RxrVgluh9rd732a4KB_on2ww'),

  // 栃木県警「ルリちゃんパトロールまっぷ」の動物TSV（gzip）。県全域・当日更新。
  // ※ .tsv は404で、.tsv.gz のみ配信されている
  {
    name: '栃木県警 動物出没(クマ)', pref: '栃木県', type: 'tsvgz',
    url: 'https://map.police.tochigi.dsvc.jp/data/map/animal2.tsv.gz',
    map: (r, i) => ({
      id: `tochigi-police-${r[0] || i}`, pref: '栃木県', city: r[5] || '',
      date: parseDate(r[6]), species: r[2] || '', kind: '目撃',
      note: [r[5], r[9]].filter(Boolean).join(' '),
      lat: num(r[3]), lon: num(r[4]),
    }),
  },
  kmlSrc('栃木県', '那須塩原市クマ目撃', '14OOPut8X1uq7mtmWk_C0NDDCG2ZHv7k'),
  kmlSrc('栃木県', '那須町クマ目撃(R7)', '1OLGJ5id84s6k1m-sh2GU7seMZ_ODEBM'),
  kmlSrc('栃木県', '那須町クマ目撃(R8)', '1OJudGWFxhEsr1sX0WbPynsmamjjlye8'),
  kmlSrc('栃木県', '矢板市クマ目撃', '1asF-iWjHH6yvFuV8kd_MNdwiW_sA32w'),

  // 島根・滋賀・神奈川・和歌山（いずれも市町村の Google マイマップ）
  kmlSrc('島根県', '邑南町クマ目撃', '1BypFC5cVKg1BYc0BZfQsInLK8j4qRcE'),
  kmlSrc('滋賀県', '大津市クマ出没', '1rE5HcSdJnm2gX3iT1FMt0aCVuQ9ArDs'),
  kmlSrc('滋賀県', '高島市クマ出没', '1a0DGKSOSsgTAhxmq-M-UCvAWY1YGN2g'),
  kmlSrc('神奈川県', '秦野市クマ目撃', '1FSQJE2a8DzKR1CC4CL7JqrYVBIOgFK0'),
  kmlSrc('神奈川県', '松田町クマ目撃', '1xb0tNcyPRRNh0OgZ3W1lkskRyy2ihhw'),
  kmlSrc('和歌山県', '有田川町クマ目撃', '1fje_Mm7vudQXTggMtOwMTzvGUiq6Bg0'),

  // 汎用投稿システムのオープンデータ（複数県。東京都はここからのみ取得できる）
  {
    name: 'sharp9110 オープンデータ(全国)', pref: '(複数)', type: 'json',
    url: 'https://public.sharp9110.com/view/opendatajson/bear',
    array: (d) => (Array.isArray(d) ? d : []),
    map: (r) => ({
      id: `sharp9110-${r.PostId}`, pref: r.PrefectureName || '',
      city: [r.CityName, r.SectionNameText].filter(Boolean).join(''),
      date: parseDate(r.IssueDate), species: 'クマ', kind: '目撃',
      note: [r.CityName, r.SectionNameText].filter(Boolean).join(''),
      lat: num(r.Latitude), lon: num(r.Longitude),
    }),
  },

  // 追加: 北海道（札幌以外）。ひぐまっぷ=全道の主力、他は市町村個別
  {
    // ひぐまっぷ: 参加65市町村 × 年度別に取得（/recent は直近3ヶ月しか返さないため）。
    // 無効なcityIdは全道データにフォールバックするので、公式の市町村リストのIDだけを使う。
    name: 'ひぐまっぷ(全道・全年度)', pref: '北海道', type: 'custom',
    fetch: fetchHigumap,
    map: (r, i) => ({
      id: `higumap-${r.id ?? i}`, pref: '北海道', city: r.cityName || '',
      date: parseDate(r.foundDt), species: 'ヒグマ', kind: r.captureFlg ? '捕獲' : '目撃',
      note: (r.popupLabel || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      lat: num(r.lat), lon: num(r.lng),
    }),
  },
  {
    name: '石狩市ヒグマ出没情報', pref: '北海道', type: 'arcgis', pageSize: 1000,
    url: 'https://services7.arcgis.com/9WKv3OOuUkGgAibZ/arcgis/rest/services/石狩市ヒグマ出没情報/FeatureServer/0',
    map: (r) => ({
      id: `ishikari-${r.OBJECTID}`, pref: '北海道', city: '石狩市',
      date: parseDate(r['日時']), species: r['種類'] || 'ヒグマ', kind: '目撃',
      note: [r['場所'], r['経緯']].filter(Boolean).join(' '),
    }),
  },
  {
    name: '室蘭市ヒグマ', pref: '北海道', type: 'arcgis', pageSize: 1000,
    url: 'https://services.arcgis.com/Jv1EECU3IM4ZRUev/arcgis/rest/services/survey123_84d34cf9cdf94dac9ba8de582423d871_results/FeatureServer/0',
    map: (r) => ({
      id: `muroran-${r.objectid}`, pref: '北海道', city: '室蘭市',
      date: parseDate(r.field_5), species: 'ヒグマ', kind: r.field_4 || '目撃',
      note: r.field_6 || '',
    }),
  },
  {
    name: '小清水町ヒグマ', pref: '北海道', type: 'arcgis', pageSize: 1000,
    url: 'https://services8.arcgis.com/TZuJIMPpKf9L0ri3/arcgis/rest/services/survey123_05dca91091024cd78098b7bab3b5a61d_results/FeatureServer/0',
    map: (r) => ({
      id: `koshimizu-${r.objectid}`, pref: '北海道', city: '小清水町',
      date: parseDate(r.field_2), species: 'ヒグマ', kind: '目撃', note: '',
    }),
  },

  // 追加: 岩手県 Bears（県公式のクマ出没共有システム）。
  // area_city_id=3 が「岩手県」全体（全市町村を含む）。年度別に取得。
  ...iwateBears([2024, 2025, 2026]),

  // 追加: 岩手県 市町村の Google My Maps（Bearsと重複しうるが期間が異なる）
  kmlSrc('岩手県', '盛岡市クマ目撃', '1QnVCL8lSy4tc9bPEhAXTBsK6SQ0ztwc'),
  kmlSrc('岩手県', '雫石町クマ目撃(R8)', '1vvY_OIMBINPBK2FPFh230vuF-TLxbAQ'),
  kmlSrc('岩手県', '雫石町クマ目撃(R7)', '1gHeKbg2kNDsCfFmOkWCBnpQRZC7H-24'),
  kmlSrc('岩手県', '雫石町クマ目撃(R5-6)', '1-jvVwDM9OMFBYQwqekyX-hgaH4shtYk'),
  kmlSrc('岩手県', '金ケ崎町クマ目撃', '1yrbsOBtjPX7oFWfy3l_ni9nqspsVxCxB'),
  kmlSrc('岩手県', '久慈市クマ目撃', '1bUcMfnTXKhE9jso-8ZG2Dijk5QDf5bo'),
  kmlSrc('岩手県', '洋野町クマ目撃', '17nj_SSSjJcQ9r7i9rHknusytZmb5zVc'),
  kmlSrc('岩手県', '岩泉町クマ目撃', '1KTq6TksWyTqlEaLgRHJ6hPnQ615uCng'),

  // 宮古市 RakuLog（HTML内の locations JS配列）
  {
    name: '宮古市クマ出没(RakuLog)', pref: '岩手県', type: 'htmljson',
    url: 'https://03001.rakulog.site/api/v1/maps?from=2015-01-01',
    extract: (html) => {
      const i = html.indexOf('const locations');
      if (i < 0) return [];
      const seg = html.slice(i, html.indexOf('];', i) + 1);
      const out = [];
      const re = /lat:\s*([\d.]+),\s*lng:\s*([\d.]+)[\s\S]*?reported_at:\s*'([^']*)',\s*location:\s*'([^']*)'/g;
      let m;
      while ((m = re.exec(seg))) {
        out.push({ lat: m[1], lng: m[2], reported_at: m[3], location: m[4] });
      }
      return out;
    },
    map: (r, i) => ({
      id: `miyako-${i}`, pref: '岩手県', city: '宮古市',
      date: parseDate(r.reported_at), species: 'ツキノワグマ', kind: '目撃',
      note: (r.location || '').replace(/^日本、〒[\d-]+\s*/, ''),
      lat: num(r.lat), lon: num(r.lng),
    }),
  },

  // 追加: HTML埋め込みJSON（福井FBI）
  {
    name: '福井県クマ情報(FBI)', pref: '福井県', type: 'htmljson',
    url: 'https://tsukinowaguma.pref.fukui.lg.jp/KUMA/Top.aspx',
    extract: (html) => {
      const m = html.match(/id="HeaderPlace_hdnKumaData"[^>]*\svalue="([^"]*)"/);
      if (!m) return [];
      const s = m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      try { return JSON.parse(s); } catch { return []; }
    },
    map: (r, i) => ({
      id: `fukui-${r.Num ?? i}`, pref: '福井県', city: r.SICHO || '',
      date: parseDate(r.HIDUKE), species: 'ツキノワグマ', kind: r.SHUBETU || '目撃',
      note: [r.BASHO, r.TOSU].filter(Boolean).join(' '),
      lat: num(r.LAT), lon: num(r.LON),
    }),
  },

  // 追加: CKAN DataStore API（山梨）
  yamanashiSrc('山梨県クマ出没(直近)', '89d2478e-e29e-46e3-9ad3-19bf44822d4d'),
  yamanashiSrc('山梨県クマ出没(過去)', '62796404-c80f-47d6-ae88-222f844ee958'),
];

function yamanashiSrc(name, resourceId) {
  return {
    name, pref: '山梨県', type: 'json',
    url: `https://catalog.dataplatform-yamanashi.jp/api/3/action/datastore_search?resource_id=${resourceId}&limit=1000`,
    array: (d) => d.result?.records || [],
    map: (r, i) => ({
      id: `yamanashi-${resourceId.slice(0, 6)}-${r._id ?? i}`, pref: '山梨県',
      city: r['目撃市町村'] || '', date: parseDate(r['年月日'] || r['目撃年月日']),
      species: 'ツキノワグマ', kind: '目撃', note: r['場所'] || '',
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  };
}

// 飯田市 GeoCloud（いいだWebまっぷ）のクマ出没レイヤ
function iidaLayer(label, layerId) {
  return {
    name: `飯田市クマ出没(${label})`, pref: '長野県', type: 'custom',
    fetch: async () => {
      const url = `https://iida.geocloud.jp/webgis/pf/maps/33-110/layers/${layerId}/items`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          Referer: 'https://iida.geocloud.jp/mp/33',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return (j.ret || []).map((row) => ({ row, coords: null }));
    },
    map: (r, i) => ({
      id: `iida-${label}-${r.itemId ?? i}`, pref: '長野県', city: '飯田市',
      date: null, species: 'ツキノワグマ', kind: '目撃',
      note: r.title || '',
      lat: num(r.lat), lon: num(r.lng),
    }),
  };
}

// 山口 YPくまっぷ（県警認知）年度別CSV。Shift_JIS・和暦日付
function yamaguchiYears() {
  const base = 'https://yamaguchi-opendata.jp/ckan/dataset/';
  const files = [
    [2023, '513e4ec1-62c0-45d3-88fc-e34dc9dfdf15/resource/717fffbb-665f-48a1-9119-dcdb9921589f/download/-04011230.csv'],
    [2024, '1d06172f-80c8-4b1f-b2d0-64f474886e97/resource/9565b85b-f459-4c0e-912d-e30578822e09/download/r6-01051231.csv'],
    [2025, '960445f5-7929-4dbc-91ad-bd54ca15433f/resource/0305d966-f716-43fa-a4cf-78b0ed2c65a1/download/r7-010112312.csv'],
    [2026, '928b40db-0a74-4ad7-b70e-019045860fd4/resource/b257b81d-4acd-4067-ba53-fe8c5235081b/download/r8-01010824.csv'],
  ];
  return files.map(([y, path]) => ({
    name: `山口県YPくまっぷ(${y})`, pref: '山口県', type: 'csv', encoding: 'shift_jis',
    url: base + path,
    map: (r, i) => ({
      id: `yamaguchi-${y}-${r['追番'] || i}`, pref: '山口県', city: '',
      date: parseDate(pick(r, '年月日')), species: 'ツキノワグマ', kind: '目撃',
      note: [pick(r, '場所'), r['状況']].filter(Boolean).join(' '),
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  }));
}

// 石川 R1-R6 分析マップ（森林/河川/誘引物/若クマ/大量出没 の5本）
function ishikawaR16() {
  const base = 'https://ckan.opendata.pref.ishikawa.lg.jp/dataset/2dfb05eb-b7c0-4285-a033-f21674c5cfe5/resource/';
  const files = [
    ['森林', '8f01fa0b-704f-4d34-a53b-42d481cf885c/download/bear_incidents_forest_r1-r6.csv'],
    ['河川', 'e611628e-582d-44b8-87a6-4d34eb1b8c1e/download/bear_incidents_river_r1-r6.csv'],
    ['誘引物', '84f43b3f-be47-46a2-a338-702c93aef9d5/download/bear_incidents_attractants_r1-r6.csv'],
    ['若クマ', '85b68640-7c2b-45f7-bc1d-3b62c5fad309/download/bear_incidents_young_bears_r1-r6.csv'],
    ['大量出没', 'dbecdeeb-8652-46bb-8a04-31a1bbb72e2a/download/bear_incidents_mass_outbreak_r2.csv'],
  ];
  return files.map(([label, path]) => ({
    name: `石川県クマ出没分析(${label} R1-R6)`, pref: '石川県', type: 'csv', url: base + path,
    map: (r, i) => ({
      id: `ishikawa-${label}-${r['ID'] || i}`, pref: '石川県', city: r['市町名'] || '',
      date: parseDate(r['出没日']), species: 'ツキノワグマ', kind: r['目撃痕跡種別'] || '目撃',
      note: [r['場所'], r['備考']].filter(Boolean).join(' '),
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  }));
}

// 岐阜 年度別 Shapefile(zip)。座標は平面直角VII系
function gifuYears() {
  const base = 'https://gifu-opendata.pref.gifu.lg.jp/dataset/08fbb219-0c54-413b-b05e-1ee5c1e9caf8/resource/';
  const files = [
    ['R7', 'ce491f12-cd79-4599-b815-ba322d890af6/download/reiwa7.zip'],
    ['R6', '2e8b1564-484a-431e-87d1-663af9606a1c/download/kumamapreiwa6.zip'],
    ['R5', '3ab4d826-b2ad-4927-a288-c18760092eb4/download/kumamapreiwa5.zip'],
    ['R4', 'd15100d3-6b03-4883-a518-cb55b00cf243/download/reiwa4.zip'],
    ['R3', 'e9efa243-4f9b-45bc-a578-b7db0af2dca1/download/reiwa3.zip'],
    ['R2', '8974576a-3fda-40a6-aee8-cbc367c82c31/download/reiwa2.zip'],
    ['H30', 'ff4616d8-659e-4a3a-8dcd-248bfb67ece3/download/h30kumashutsubotsu.zip'],
    ['H29', '9715f73a-aac0-4634-a36a-2916b49135d2/download/h29kumashutsubotsu.zip'],
    ['H28', '5559dbbf-8205-4179-91da-69f3033a9280/download/h28kumashutsubotsu.zip'],
    ['H27', '3015c2a2-2a44-4381-bc17-dd04dbcb247e/download/h27kumashutsubotsu.zip'],
    ['H26', '4c8ab7b9-fd13-423d-9504-ec357855d466/download/h26kumashutsubotsu.zip'],
  ];
  return files.map(([label, path]) => ({
    name: `岐阜県クマ出没(${label})`, pref: '岐阜県', type: 'shpzip', proj: JPRCS_VII,
    url: base + path,
    map: (_r, i) => ({
      id: `gifu-${label}-${i}`, pref: '岐阜県', city: '', date: null,
      species: 'ツキノワグマ', kind: '目撃', note: '',
    }),
  }));
}

// 岩手Bears: /reports/map ページの locations JS配列（サーバレンダリング）を抽出
function iwateBears(years) {
  return years.map((y) => ({
    name: `岩手県Bears(${y})`, pref: '岩手県', type: 'htmljson',
    url: `https://bears8.com/iwate/reports/map?area_city_id=3&yrFlg=${y}`,
    extract: (html) => {
      const i = html.indexOf('locations =');
      if (i < 0) return [];
      const seg = html.slice(i, html.indexOf('];', i) + 1);
      const out = [];
      const re = /lat:\s*([\d.]+),\s*lng:\s*([\d.]+),\s*sighted_at:\s*"([^"]*)"[\s\S]*?sighted_address:\s*"([^"]*)"/g;
      let m;
      while ((m = re.exec(seg))) {
        out.push({ lat: m[1], lng: m[2], sighted_at: m[3], sighted_address: m[4] });
      }
      return out;
    },
    map: (r, i) => ({
      id: `iwate-bears-${y}-${i}`, pref: '岩手県', city: '',
      date: parseDate(r.sighted_at), species: 'ツキノワグマ', kind: '目撃',
      note: r.sighted_address || '',
      lat: num(r.lat), lon: num(r.lng),
    }),
  }));
}

function tottoriYears(years) {
  return years.map((y) => ({
    name: `鳥取県クマ出没(${y})`, pref: '鳥取県', type: 'geojson',
    url: `https://tottori.smartcity.geolonia.com/data/BearSightingMap_${y}/latest/geojson/data.geojson`,
    map: (r, i) => ({
      id: `tottori-${y}-${i}`, pref: '鳥取県', city: r['場所'] || '',
      date: parseDate(r['日にち'] || ''), species: 'ツキノワグマ', kind: '目撃',
      note: r['場所'] || '',
    }),
  }));
}

function kmlSrc(pref, name, mid) {
  let n = 0;
  return {
    name, pref, type: 'kml',
    url: `https://www.google.com/maps/d/kml?mid=${mid}&forcekml=1`,
    map: (r) => ({
      id: `${pref}-${mid.slice(0, 6)}-${n++}`, pref, city: '',
      date: parseDate(`${r.name} ${r.description}`), species: 'ツキノワグマ', kind: '目撃',
      note: (r.name || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    }),
  };
}

function sapporoYears(years) {
  const res = {
    2017: '6d2ebe8d-d683-41b6-83b5-0395a3e795ae/download/2017sapporobearappearance.csv',
    2018: 'e33993cc-4ef1-4916-9cad-1e9d585f9427/download/2018sapporobearappearance.csv',
    2019: '6a9c917a-1fe1-4217-876b-e1ffa5138144/download/2019sapporobearappearance.csv',
    2020: '9647f46b-6e07-4209-8b3e-45c8b329e579/download/2020sapporobearappearance.csv',
    2021: 'a9255555-4afa-4450-8c00-8bac4b24d088/download/2021sapporobearappearance.csv',
    2022: '37fd8fe6-b1c1-4c0a-b3a8-85cc3958603d/download/2022sapporobearappearance.csv',
    2023: '3d6c0e28-7247-4503-b248-258e59192b99/download/2023sapporobearappearance.csv',
    2024: 'b289a37b-9149-4e34-981f-6743488d5779/download/2024sapporobearappearance.csv',
    2025: '76c539c8-cd17-4449-a972-6ddc8c3d5306/download/2025sapporobearappearance.csv',
  };
  const base = 'https://ckan.pf-sapporo.jp/dataset/0d3197ef-c473-48ac-86bd-0fc34084b0ee/resource/';
  return years.map((y) => ({
    name: `札幌市ヒグマ出没情報 ${y}`, pref: '北海道', type: 'csv', url: base + res[y],
    map: (r, i) => ({
      id: `sapporo-${y}-${i}`, pref: '北海道', city: `札幌市${r['区'] || ''}`,
      date: parseDate(`${r['日付']} ${r['時刻'] || ''}`.trim()),
      species: 'ヒグマ', kind: '目撃',
      note: `${r['出没場所'] || ''} ${r['状況'] || ''}`.trim(),
      lat: num(r['緯度']), lon: num(r['経度']),
    }),
  }));
}

// ---- ユーティリティ ---------------------------------------------------------
const num = (v) => {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
};
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// ヘッダ名の表記ゆれ対策: 部分一致でキーを探す
const pick = (row, part) => {
  const k = Object.keys(row).find((h) => h.includes(part));
  return k ? row[k] : '';
};

const toHalf = (s) => String(s).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const isoymd = (y, mo, da) => {
  const d = new Date(Date.UTC(+y, +mo - 1, +da));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// あらゆる日付表記（epoch/和暦R7.8.5/令和8年1月4日/ISO・スラッシュ・ドット・自由文）→ ISO
function parseDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' || /^\d{12,}$/.test(String(v).trim())) {
    const d = new Date(Number(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = toHalf(String(v).trim());
  let m = s.match(/^([RHSM])\.?\s*(\d{1,2})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})/);
  if (m) { const base = { R: 2018, H: 1988, S: 1925, M: 1867 }[m[1]]; return isoymd(base + +m[2], m[3], m[4]); }
  m = s.match(/(令和|平成|昭和)\s*(\d{1,2}|元)年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) { const base = { 令和: 2018, 平成: 1988, 昭和: 1925 }[m[1]]; const y = m[2] === '元' ? 1 : +m[2]; return isoymd(base + y, m[3], m[4]); }
  m = s.match(/(20\d{2})[.\-/年]\s*(\d{1,2})[.\-/月]\s*(\d{1,2})/);
  if (m) return isoymd(m[1], m[2], m[3]);
  return null;
}

// RFC4180 準拠の最小 CSV パーサ
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// KML の Placemark から {name, description, coords} を抽出
function parseKml(text) {
  const strip = (s) => String(s).replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
  const out = [];
  const pms = text.match(/<Placemark[\s\S]*?<\/Placemark>/g) || [];
  for (const pm of pms) {
    const cm = pm.match(/<coordinates>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
    if (!cm) continue;
    const lon = parseFloat(cm[1]), lat = parseFloat(cm[2]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const name = strip((pm.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '');
    const description = strip((pm.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '');
    out.push({ row: { name, description }, coords: [lon, lat] });
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// レート制限(403/429/5xx)を指数バックオフでリトライ
async function fetchRetry(url, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await sleep(2000 * i);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'kmap-etl/0.1' } });
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
      // レート制限・一時的サーバエラー以外は即中断
      if (![403, 429, 500, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      last = e.message; // ネットワーク断（fetch failed）もリトライ対象
    }
  }
  throw new Error(last);
}

async function fetchBuf(url) {
  return (await fetchRetry(url)).arrayBuffer();
}

async function fetchArcgis(base, pageSize) {
  const out = [];
  pageSize = Math.min(pageSize || 1000, 1000); // サーバのmaxRecordCount上限を超えない
  for (let offset = 0; offset < 500000; offset += pageSize) {
    const u = `${base}/query?where=1%3D1&outFields=*&f=geojson&resultRecordCount=${pageSize}&resultOffset=${offset}`;
    const j = await (await fetchRetry(u)).json();
    const feats = j.features || [];
    out.push(...feats);
    if (feats.length < pageSize) break;
  }
  return out.map((f) => ({ row: f.properties || {}, coords: f.geometry?.coordinates }));
}

async function fetchShpZip(url, projDef) {
  const buf = await fetchBuf(url);
  const geo = await shp(buf);
  const fcs = Array.isArray(geo) ? geo : [geo];
  const out = [];
  for (const fc of fcs) for (const f of (fc.features || [])) {
    const g = f.geometry; if (!g) continue;
    let coords = g.type === 'Point' ? g.coordinates : (g.type === 'MultiPoint' ? g.coordinates[0] : null);
    if (!coords) continue;
    if (projDef) coords = proj4(projDef, 'WGS84', coords);
    out.push({ row: f.properties || {}, coords });
  }
  return out;
}

async function fetchJson(url, arrayFn) {
  const res = await fetchRetry(url);
  const d = await res.json();
  return (arrayFn ? arrayFn(d) : d).map((row) => ({ row, coords: null }));
}

async function fetchGeojson(url) {
  const res = await fetchRetry(url);
  const d = await res.json();
  return (d.features || []).map((f) => ({ row: f.properties || {}, coords: f.geometry?.coordinates }));
}

// ひぐまっぷ: 市町村リストを取り、各市町村 × 年度で全件を集める。
// レポートIDで一意化する（同一出没が複数の照会に出るため）。
async function fetchHigumap() {
  const cities = await (await fetchRetry('https://higumap.info/public/json/getTopPageCityList')).json();
  const years = [];
  const thisYear = new Date().getFullYear() + 1; // 年度は年跨ぎのため+1まで見る
  for (let y = 2019; y <= thisYear; y++) years.push(y);

  const uniq = new Map();
  const queue = [];
  for (const c of cities) for (const y of years) queue.push([c, y]);

  // 同時実行数を絞って相手サーバへの負荷を抑える
  const CONC = 6;
  let idx = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (idx < queue.length) {
      const [c, y] = queue[idx++];
      const u = `https://higumap.info/map/reportsJson?cityId=${c.id}&fiscalYear=${y}`;
      try {
        const res = await fetch(u, {
          headers: { 'User-Agent': 'kmap-etl/0.1', Referer: 'https://higumap.info/' },
        });
        if (!res.ok) continue;
        const j = await res.json();
        for (const r of j.ocList || []) {
          if (!uniq.has(r.id)) uniq.set(r.id, { ...r, cityName: c.name });
        }
      } catch { /* 1件の失敗で全体を止めない */ }
    }
  }));
  return [...uniq.values()].map((row) => ({ row, coords: null }));
}

// gzip圧縮されたTSV（栃木県警）。ヘッダ行が無く列インデックスで参照する
async function fetchTsvGz(url) {
  const buf = Buffer.from(await fetchBuf(url));
  const text = new TextDecoder('utf-8').decode(gunzipSync(buf));
  return text.split('\n').filter((l) => l.trim())
    .map((line) => ({ row: line.split('\t'), coords: null }));
}

// 素のTSV（ヘッダ行なし・列インデックス参照）。サーバがgzipで送るのはfetchが自動展開する
async function fetchTsv(url) {
  const text = new TextDecoder('utf-8').decode(await fetchBuf(url));
  return text.split('\n').filter((l) => l.trim())
    .map((line) => ({ row: line.split('\t'), coords: null }));
}

async function fetchHtmlJson(url, extract) {
  const html = new TextDecoder('utf-8').decode(await fetchBuf(url));
  return extract(html).map((row) => ({ row, coords: null }));
}

const isBear = (species) => /[クグ]マ|熊/.test(species || '');
// 日本のクマ生息域内の妥当な座標か。最南は四国剣山(33.8N)・紀伊(33.7N)なので
// 緯度33.0未満は出典側の座標誤り（例: 海上）として除外する。
const inJapan = (lat, lon) =>
  lat != null && lon != null && lat >= 33.0 && lat <= 46 && lon >= 128 && lon <= 146;

// 既存の sightings.geojson を読む（アーカイブ用。無ければ空）
async function loadPrevious() {
  try {
    const raw = await readFile(join(OUT_DIR, 'sightings.geojson'), 'utf8');
    return JSON.parse(raw).features || [];
  } catch {
    return [];
  }
}

// ---- メイン -----------------------------------------------------------------
async function main() {
  const features = [];
  const stats = {};
  const failed = [];
  let droppedGeo = 0;

  for (const src of SOURCES) {
    process.stdout.write(`取得中: ${src.name} ... `);
    let items;
    try {
      if (src.type === 'custom') items = await src.fetch();
      else if (src.type === 'arcgis') items = await fetchArcgis(src.url, src.pageSize || 1000);
      else if (src.type === 'kml') items = parseKml(new TextDecoder('utf-8').decode(await fetchBuf(src.url)));
      else if (src.type === 'shpzip') items = await fetchShpZip(src.url, src.proj);
      else if (src.type === 'json') items = await fetchJson(src.url, src.array);
      else if (src.type === 'geojson') items = await fetchGeojson(src.url);
      else if (src.type === 'htmljson') items = await fetchHtmlJson(src.url, src.extract);
      else if (src.type === 'tsvgz') items = await fetchTsvGz(src.url);
      else if (src.type === 'tsv') items = await fetchTsv(src.url);
      else { // csv
        const text = new TextDecoder(src.encoding || 'utf-8').decode(await fetchBuf(src.url));
        items = parseCSV(text).map((r) => ({ row: r, coords: null }));
      }
    } catch (e) {
      console.log(`失敗 (${e.message})`);
      failed.push(`${src.name}: ${e.message}`);
      continue;
    }

    let ok = 0;
    items.forEach((it, i) => {
      const p = src.map(it.row, i);
      const lon = it.coords ? it.coords[0] : p.lon;
      const lat = it.coords ? it.coords[1] : p.lat;
      if (!isBear(p.species)) return;
      if (!inJapan(lat, lon)) { if (lat != null && lon != null) droppedGeo++; return; }
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [round5(lon), round5(lat)] },
        properties: {
          id: p.id, pref: p.pref, city: p.city, date: p.date,
          species: p.species, kind: p.kind, note: p.note,
        },
      });
      ok++;
    });
    stats[src.pref] = (stats[src.pref] || 0) + ok;
    console.log(`${ok} 件`);
  }

  // アーカイブ: 「直近分しか公開しないソース」(ひぐまっぷ/青森くまログ/山梨/福井など)は
  // 実行のたびに古い分が消える。前回の結果と統合して履歴を積み上げる。
  // 出典側が誤りを訂正した場合も残るが、点の消失より欠測の方が実害が大きいため許容する。
  const prev = await loadPrevious();
  const beforeMerge = features.length;
  for (const f of prev) features.push(f); // 大配列の spread はスタック超過するため逐次push
  const archived = prev.length;

  // 重複除去: 同一県で「日付(日単位)＋座標(小数4桁≒11m)」が一致するものは
  // 同じ出没が複数ソース（例: 岩手のBearsと市町村マップ）に載っているとみなす。
  const seen = new Set();
  const deduped = [];
  let dupes = 0;
  for (const f of features) {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const day = p.date ? p.date.slice(0, 10) : '';
    // id は取得元ごとに決定的なので、前回分との統合ではこれが効く。
    // 日付の無いレコードも id で必ず一意化する（放置すると実行のたびに倍増する）。
    const idKey = `id:${p.id}`;
    if (seen.has(idKey)) { dupes++; continue; }
    seen.add(idKey);
    // 別ソースが同じ出没を載せている場合は「県+日付+座標(約11m)」で寄せる
    if (day) {
      const geoKey = `${p.pref}|${day}|${lon.toFixed(4)}|${lat.toFixed(4)}`;
      if (seen.has(geoKey)) { dupes++; continue; }
      seen.add(geoKey);
    }
    deduped.push(f);
  }
  features.length = 0;
  features.push(...deduped);

  // 出力順を id で固定する。実行のたびに並びが変わると git の差分が全行になり、
  // 日次コミットでリポジトリが不必要に肥大化するため。
  features.sort((a, b) => (a.properties.id < b.properties.id ? -1 : a.properties.id > b.properties.id ? 1 : 0));

  await mkdir(OUT_DIR, { recursive: true });
  const fc = { type: 'FeatureCollection', generatedAt: new Date().toISOString(), features };
  await writeFile(join(OUT_DIR, 'sightings.geojson'), JSON.stringify(fc));

  const finalStats = {};
  for (const f of features) {
    const p = f.properties.pref;
    finalStats[p] = (finalStats[p] || 0) + 1;
  }
  const meta = {
    total: features.length, generatedAt: fc.generatedAt, byPref: finalStats,
    prefs: [...new Set(features.map((f) => f.properties.pref))].sort(),
  };
  await writeFile(join(OUT_DIR, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`\n合計 ${features.length} 件 → public/data/sightings.geojson`);
  console.log(`座標範囲外で除外: ${droppedGeo} 件`);
  console.log(`今回取得: ${beforeMerge.toLocaleString()} 件 / 前回分と統合: ${archived.toLocaleString()} 件`);
  if (failed.length) {
    console.log(`\n⚠ 取得失敗 ${failed.length} 件（一時的なレート制限等。再実行で回復する場合あり）:`);
    for (const f of failed) console.log('  -', f);
  }
  console.log(`重複除去: ${dupes} 件`);
  console.log('都道府県別:', finalStats);
}

main().catch((e) => { console.error(e); process.exit(1); });
