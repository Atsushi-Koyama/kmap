<script lang="ts">
  import { onMount } from 'svelte';
  let { data } = $props();
  const total = $derived(data.total);
  const generatedAt = $derived(data.generatedAt);
  const updated = $derived(new Date(generatedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }));
  const prefs = $derived(data.prefs ?? []);
  let el: HTMLDivElement;

  // 操作パネルの状態
  let view = $state<'points' | 'risk'>('points');
  let prefSel = $state('');   // '' = すべて。値は都道府県名
  let period = $state('0');   // 0=すべて / 30 / 90 / 365（日数）
  let shown = $state(0);      // 絞り込み後の件数

  // maplibre のインスタンスは描画後に触るので外に持つ
  let mapRef: any = null;

  // 絞り込みは maplibre の filter 式で行う。10万件を JS で作り直すと
  // 操作のたびにメインスレッドが固まるため、GPU側の評価に任せる。
  function buildFilter(): any {
    const conds: any[] = [];
    if (prefSel) {
      const i = prefs.findIndex((p) => p.pref === prefSel);
      if (i >= 0) conds.push(['==', ['get', 'p'], i]);
    }
    const days = Number(period);
    if (days > 0) {
      // properties.d は 'YYYY-MM'。月単位で足切りする
      const since = new Date(Date.now() - days * 86400000);
      const ym = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}`;
      conds.push(['>=', ['coalesce', ['get', 'd'], ''], ym]);
    }
    return conds.length ? ['all', ...conds] : null;
  }

  async function applyFilter() {
    if (!mapRef) return;
    const f = buildFilter();

    // クラスタ点は集約後の擬似地物で、元の properties（p / d）を持たない。
    // そのため絞り込み中はクラスタを使えない。素の点に切り替える。
    const filtering = !!f;
    const src = mapRef.getSource('s');
    if (src && src.setClusterOptions) {
      src.setClusterOptions({ cluster: !filtering, clusterRadius: 50, clusterMaxZoom: 12 });
    }
    for (const id of ['clusters', 'cluster-count']) {
      if (mapRef.getLayer(id)) {
        mapRef.setLayoutProperty(id, 'visibility',
          filtering || view === 'risk' ? 'none' : 'visible');
      }
    }
    if (mapRef.getLayer('points')) {
      mapRef.setFilter('points', f ?? ['!', ['has', 'point_count']]);
      mapRef.setLayoutProperty('points', 'visibility', view === 'risk' ? 'none' : 'visible');
      // 絞り込むと1画面に数万点が乗る。既定の大きさ・不透明のままだと
      // 塗り潰しになって密度が読めないので、小さく薄くして重なりで濃淡を出す。
      mapRef.setPaintProperty('points', 'circle-radius',
        filtering
          ? ['interpolate', ['linear'], ['zoom'], 5, 1.5, 8, 3, 12, 6]
          : 6);
      mapRef.setPaintProperty('points', 'circle-opacity', filtering ? 0.35 : 1);
      mapRef.setPaintProperty('points', 'circle-stroke-width', filtering ? 0 : 1.5);
    }
    if (mapRef.getLayer('heat')) mapRef.setFilter('heat', f ?? null);

    // 県を選んだらその県へ寄せる。全国のままだと絞った実感が無い
    if (prefSel) await flyToPref(prefSel);
    else mapRef.easeTo({ center: [137.5, 37.4], zoom: 4.7, duration: 600 });

    updateCount();
  }

  // 県の範囲は県境データから求める（毎回全点を走査しないで済む）
  let prefBounds: Record<string, [number, number, number, number]> | null = null;
  async function flyToPref(name: string) {
    if (!prefBounds) {
      prefBounds = {};
      try {
        const geo = await (await fetch('/api/prefectures.geojson')).json();
        for (const f of geo.features ?? []) {
          const nm = f.properties?.nam_ja;
          if (!nm) continue;
          let x1 = 999, y1 = 999, x2 = -999, y2 = -999;
          const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
          for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
            if (x < x1) x1 = x; if (y < y1) y1 = y;
            if (x > x2) x2 = x; if (y > y2) y2 = y;
          }
          prefBounds[nm] = [x1, y1, x2, y2];
        }
      } catch { /* 取れなければ寄せない */ }
    }
    const b = prefBounds?.[name];
    if (b) mapRef.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, duration: 700 });
  }

  // 表示件数。querySourceFeatures は画面内の読み込み済みタイルしか返さないため
  // 件数の集計には使えない（全国表示で12件などになる）。
  // 絞り込み条件は県と月だけなので、県別の件数表から算出する。
  let monthly: Record<string, number[]> | null = null;

  async function loadCounts() {
    if (monthly) return;
    try {
      monthly = await (await fetch('/api/month-counts.json')).json();
    } catch { monthly = {}; }
  }

  function updateCount() {
    const days = Number(period);
    // 期間指定なし → 県の総数をそのまま使える
    if (!days) {
      shown = prefSel
        ? (prefs.find((p) => p.pref === prefSel)?.count ?? total)
        : total;
      return;
    }
    if (!monthly) { void loadCounts().then(updateCount); return; }
    const since = new Date(Date.now() - days * 86400000);
    const from = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}`;
    let n = 0;
    for (const [pref, months] of Object.entries(monthly)) {
      if (prefSel && pref !== prefSel) continue;
      for (const [ym, c] of Object.entries(months as unknown as Record<string, number>)) {
        if (ym >= from) n += c;
      }
    }
    shown = n;
  }

  function applyView() {
    if (!mapRef) return;
    if (mapRef.getLayer('heat')) {
      mapRef.setLayoutProperty('heat', 'visibility', view === 'risk' ? 'visible' : 'none');
    }
    // 点・クラスタの出し分けは絞り込み状態にも依存するので applyFilter に任せる
    void applyFilter();
  }
  // 枠内に出す読み込み表示。地図の描画が始まったら消すだけの飾りで、
  // ここに機能を載せない（描画イベントが来ない環境で地図ごと止まるため）。
  let status = $state('地図を読み込み中…');

  // 原因調査用。画面に出ない失敗を追えるようにする。
  const log: string[] = [];
  const mark = (m: string) => { log.push(`${Math.round(performance.now())}ms ${m}`); };
  // WebGL が使えない環境では地図を出せない。その場合だけ一覧への導線を出す。
  let fallback = $state(false);
  // WebGLが無い場合に使う代替地図（canvas 2D）
  let canvasEl: HTMLCanvasElement;

  // WebGL が使えるかの目安。ただしこれで描画可否を決めてはいけない。
  // 分離canvasでの getContext は、GPUがソフトウェア描画に落ちている場合や
  // 他タブがWebGLコンテキストを使い切っている場合に false を返すことがあり、
  // 実際には maplibre が問題なく動く環境まで弾いてしまう。
  // ここは「失敗したときの理由の切り分け」にだけ使う。
  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      // 性能が出ない環境でも描画自体は可能なので、この判定では拒否しない
      const opts = { failIfMajorPerformanceCaveat: false } as WebGLContextAttributes;
      const gl = (c.getContext('webgl2', opts) ||
        c.getContext('webgl', opts)) as WebGLRenderingContext | null;
      if (!gl) return false;
      // 判定用のコンテキストを残すと同時接続数の上限を圧迫するので即解放する
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return true;
    } catch { return false; }
  }

  const NO_WEBGL = 'このブラウザでは地図を表示できません（WebGLが無効です）。';

  const esc = (value: unknown) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

  function formatDate(value: unknown) {
    const date = String(value ?? '');
    if (!date) return '日時不明';
    if (date.length === 10) {
      return `${new Date(date).toLocaleDateString('ja-JP', { timeZone: 'UTC' })}（時刻不明）`;
    }
    return new Date(date).toLocaleString('ja-JP');
  }

  onMount(async () => {
    // ここで throw すると status が初期値のまま固まり、画面上は
    // 「読み込み中」と区別が付かない。必ず理由を表示に出す。
    try {
      await boot();
    } catch (e) {
      // WebGL 生成失敗は maplibre が巨大なJSON文字列を message に入れてくる。
      // そのまま出すと画面が壊れるので、原因はコンソールだけに残す。
      const raw = e instanceof Error ? e.message : String(e);
      if (!webglAvailable() || /webgl/i.test(raw)) {
        status = NO_WEBGL;
        fallback = true;
        void showFallbackMap();
      } else {
        status = `地図を初期化できませんでした: ${raw.slice(0, 120)}`;
      }
      console.error('[kmap] 初期化失敗', e);
    }
    (window as any).__kmap = { log, status: () => status };
  });

  // WebGLが使えない環境でも地図そのものは出す。リンクだけ出して終わりにすると
  // 地図サイトとして成立しないため、簡易版を描く。
  async function showFallbackMap() {
    try {
      const { renderFallbackMap } = await import('$lib/fallbackMap');
      // canvas が DOM に載るのを待つ
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      if (canvasEl) {
        await renderFallbackMap(canvasEl);
        mark('代替地図の描画完了');
        status = '簡易表示です（このブラウザではWebGLが使えないため）。';
      }
    } catch (e) {
      console.error('[kmap] 代替地図の描画失敗', e);
    }
  }

  async function boot() {
    mark('boot開始');
    // 事前判定で弾かない。描画できるかの最終的な答えは maplibre 自身しか持たず、
    // 自前の判定で先回りすると、実際には動く環境で地図を出せなくなる。
    // 失敗したら onMount 側の catch が理由を出す。
    if (!webglAvailable()) mark('WebGL判定は false（それでも初期化を試す）');
    const maplibregl = (await import('maplibre-gl')).default;
    mark('maplibre読み込み完了');
    await import('maplibre-gl/dist/maplibre-gl.css');
    mark('CSS読み込み完了');

    // ソースとレイヤは map.on('load') を待たず、最初のスタイルに全部書く。
    // load は「スタイル読み込み＋最初の描画完了」で初めて発火するので、
    // バックグラウンドタブなど描画が始まらない状況では永久に来ない。
    // そこにデータ投入を置くと、地図が白いまま何も出ない状態になる。
    const map = new maplibregl.Map({
      container: el,
      style: {
        version: 8,
        glyphs: '/font/{fontstack}/{range}.pbf',
        sources: {
          gsi: {
            type: 'raster',
            tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル</a>',
            maxzoom: 18,
          },
          // data は URL で渡すこと。オブジェクトで渡すと 10万件の転送で
          // メインスレッドが数秒固まる。URL ならワーカー側で完結する。
          s: {
            // データ更新時はURLも変え、ブラウザ/CDNの古いGeoJSONを確実に避ける。
            type: 'geojson', data: `/api/points.geojson?v=${encodeURIComponent(generatedAt)}`,
            cluster: true, clusterRadius: 50, clusterMaxZoom: 12,
          },
        },
        layers: [
          { id: 'gsi', type: 'raster', source: 'gsi' },
          {
            id: 'clusters', type: 'circle', source: 's', filter: ['has', 'point_count'],
            paint: {
              'circle-color': ['step', ['get', 'point_count'], '#f1a340', 50, '#e08214', 200, '#b35806'],
              'circle-radius': ['step', ['get', 'point_count'], 16, 50, 22, 200, 30],
              'circle-opacity': 0.85,
            },
          },
          {
            id: 'cluster-count', type: 'symbol', source: 's', filter: ['has', 'point_count'],
            layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
            paint: { 'text-color': '#fff' },
          },
          {
            // リスク表示。密度をそのまま見せる方が2kmメッシュより直感的で、
            // ズームしても破綻しない。
            id: 'heat', type: 'heatmap', source: 's',
            layout: { visibility: 'none' },
            paint: {
              'heatmap-weight': 0.6,
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, 1, 12, 3],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, 12, 12, 30],
              'heatmap-opacity': 0.75,
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(0,0,0,0)',
                0.2, '#fef0d9', 0.4, '#fdcc8a', 0.6, '#fc8d59',
                0.8, '#d7301f', 1, '#7f0000',
              ],
            },
          },
          {
            id: 'points', type: 'circle', source: 's', filter: ['!', ['has', 'point_count']],
            paint: { 'circle-color': '#b35806', 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
          },
        ],
      },
      center: [137.5, 37.4],
      zoom: 4.7,
      // GPUが使えずソフトウェア描画になる環境でも表示を優先する。
      // 既定のままだと「性能が出ない」という理由だけで初期化が失敗しうる。
      failIfMajorPerformanceCaveat: false,
    });
    mark('Map生成完了');
    mapRef = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: true }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
    // データ読み込み後に件数を出す
    map.on('sourcedata', (ev: any) => {
      if (ev.sourceId === 's' && ev.isSourceLoaded) updateCount();
    });
    map.on('click', 'clusters', async (e) => {
      const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const source = map.getSource('s') as InstanceType<typeof maplibregl.GeoJSONSource>;
      const zoom = await source.getClusterExpansionZoom(feature.properties?.cluster_id);
      map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
    });
    map.on('click', 'points', (e) => {
      const feature = e.features?.[0];
      if (!feature || feature.geometry.type !== 'Point') return;
      const p = feature.properties ?? {};
      const place = [p.p, p.c].filter(Boolean).map(esc).join(' ');
      new maplibregl.Popup({ maxWidth: '300px' })
        .setLngLat(feature.geometry.coordinates as [number, number])
        .setHTML(
          `<div class="popup-date">${esc(formatDate(p.d))}</div>` +
          (place ? `<div class="popup-place">${place}</div>` : '') +
          (p.n ? `<div class="popup-note">${esc(p.n)}</div>` : ''),
        )
        .addTo(map);
    });
    for (const layer of ['clusters', 'points']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('error', (e) => {
      const err = (e as any)?.error;
      const msg = err?.message ?? String(err ?? e);
      // 操作でタイル取得が中断されたときも error として飛んでくる。
      // 画面移動のたびに起きる正常な事象なので、これを画面に出してはいけない。
      const transient = err?.name === 'AbortError'
        || /abort|cancell?ed|Failed to fetch|NetworkError/i.test(msg);
      if (transient) return;
      status = `地図の読み込みでエラー: ${msg}`;
      console.error('[kmap] map error', e);
    });
    map.on('styledata', () => mark('styledata'));
    map.on('load', () => mark('load'));
    map.once('idle', () => { mark('idle'); status = ''; });
    (window as any).__kmap = { map, log, status: () => status };
  }
</script>

<svelte:head>
  <title>全国クマ出没マップ（地図）- クママップ</title>
  <meta name="description" content="全国のクマ出没・目撃情報を地図上で確認できます。" />
</svelte:head>

<h1>全国クマ出没マップ</h1>
<p class="c">
  {(shown || total).toLocaleString()} 件
  {#if shown && shown !== total}<span class="of">/ 全{total.toLocaleString()}件</span>{/if}
  ・データ更新: {updated}
</p>

<div class="controls">
  <label>
    <span>表示</span>
    <select bind:value={view} onchange={applyView}>
      <option value="points">出没地点</option>
      <option value="risk">密度（ヒートマップ）</option>
    </select>
  </label>
  <label>
    <span>都道府県</span>
    <select bind:value={prefSel} onchange={applyFilter}>
      <option value="">すべて</option>
      {#each prefs as p}<option value={p.pref}>{p.pref}（{p.count.toLocaleString()}）</option>{/each}
    </select>
  </label>
  <label>
    <span>期間</span>
    <select bind:value={period} onchange={applyFilter}>
      <option value="0">すべて</option>
      <option value="30">直近30日</option>
      <option value="90">直近90日</option>
      <option value="365">直近1年</option>
    </select>
  </label>
  {#if prefSel}
    <a class="tolist" href="/pref/{prefs.find((p) => p.pref === prefSel)?.slug}/">
      {prefSel}の詳細を見る →
    </a>
  {/if}
</div>

{#if view === 'risk'}
  <ul class="legend">
    <li><i style="background:#fef0d9"></i>少</li>
    <li><i style="background:#fdcc8a"></i></li>
    <li><i style="background:#fc8d59"></i></li>
    <li><i style="background:#d7301f"></i></li>
    <li><i style="background:#7f0000"></i>多</li>
    <span>出没の密度</span>
  </ul>
{/if}

<div class="wrap">
  <div class="map" bind:this={el} hidden={fallback}></div>
  {#if fallback}
    <canvas class="map fb" bind:this={canvasEl}></canvas>
  {/if}
  {#if status}
    <p class="status" class:corner={fallback}>
      {status}
      {#if fallback}<a href="/pref/">都道府県別の一覧で見る →</a>{/if}
    </p>
  {/if}
</div>
<p><a href="/pref/">都道府県別の一覧を見る →</a></p>

<style>
  h1 { font-size: 22px; margin: 6px 0 8px; }
  .of { color: #9a8d7e; font-size: 12px; }
  .controls {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end;
    margin: 0 0 10px; padding: 10px 12px;
    background: #fff; border: 1px solid #e6ddd1; border-radius: 10px;
  }
  .controls label { display: flex; flex-direction: column; gap: 3px; font-size: 11.5px; color: #7a6c5d; }
  .controls select {
    padding: 6px 8px; font-size: 13.5px; border: 1px solid #d8ccbb;
    border-radius: 6px; background: #fff; color: #1f1a15; min-width: 130px;
  }
  .controls .tolist {
    margin-left: auto; font-size: 13px; color: #8a4d2b; font-weight: 600;
    text-decoration: none; padding-bottom: 6px;
  }
  .legend { display: flex; align-items: center; gap: 4px; list-style: none; padding: 0; margin: 0 0 8px; font-size: 11.5px; color: #7a6c5d; }
  .legend i { display: block; width: 26px; height: 10px; border-radius: 2px; }
  .legend li { display: flex; align-items: center; gap: 4px; }
  .legend span { margin-left: 8px; }
  @media (max-width: 600px) {
    .controls select { min-width: 0; width: 100%; }
    .controls label { flex: 1 1 45%; }
    .controls .tolist { margin-left: 0; flex-basis: 100%; }
  }
  .c { font-size: 13px; color: #7a6c5d; margin: 0 0 10px; }
  .wrap { position: relative; }
  .map { width: 100%; height: 70vh; border-radius: 10px; overflow: hidden; border: 1px solid #e6ddd1; }
  .map.fb { display: block; background: #dfe9f3; }
  /* 代替地図では地図の上に文字が被らないよう下端に寄せる */
  .status.corner {
    top: auto; bottom: 10px; left: 50%; transform: translateX(-50%);
    background: rgba(255,255,255,.92); padding: 6px 14px; border-radius: 8px;
    font-size: 12px; white-space: nowrap;
  }
  .status {
    position: absolute; inset: 0; margin: 0; display: flex;
    flex-direction: column; gap: 8px; padding: 0 16px;
    align-items: center; justify-content: center; text-align: center;
    font-size: 14px; color: #7a6c5d;
    pointer-events: none; /* 読み込み中に地図の操作を奪わない */
  }
  .status a { pointer-events: auto; }
  :global(.popup-date) { font-weight: 700; margin-bottom: 4px; }
  :global(.popup-place) { color: #5a4f44; margin-bottom: 4px; }
  :global(.popup-note) { line-height: 1.55; }
</style>
