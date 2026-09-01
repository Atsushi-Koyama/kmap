<script lang="ts">
  import { onMount } from 'svelte';
  let { data } = $props();
  const total = $derived(data.total);
  const generatedAt = $derived(data.generatedAt);
  const updated = $derived(new Date(generatedAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }));
  let el: HTMLDivElement;
  // 枠内に出す読み込み表示。地図の描画が始まったら消すだけの飾りで、
  // ここに機能を載せない（描画イベントが来ない環境で地図ごと止まるため）。
  let status = $state('地図を読み込み中…');

  // 原因調査用。画面に出ない失敗を追えるようにする。
  const log: string[] = [];
  const mark = (m: string) => { log.push(`${Math.round(performance.now())}ms ${m}`); };
  // WebGL が使えない環境では地図を出せない。その場合だけ一覧への導線を出す。
  let fallback = $state(false);

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
      } else {
        status = `地図を初期化できませんでした: ${raw.slice(0, 120)}`;
      }
      console.error('[kmap] 初期化失敗', e);
    }
    (window as any).__kmap = { log, status: () => status };
  });

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
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
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
      const msg = (e as any)?.error?.message ?? String((e as any)?.error ?? e);
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
<p class="c">{total.toLocaleString()} 件・データ更新: {updated}</p>
<div class="wrap">
  <div class="map" bind:this={el}></div>
  {#if status}
    <p class="status">
      {status}
      {#if fallback}<a href="/pref/">都道府県別の一覧で見る →</a>{/if}
    </p>
  {/if}
</div>
<p><a href="/pref/">都道府県別の一覧を見る →</a></p>

<style>
  h1 { font-size: 22px; margin: 6px 0 8px; }
  .c { font-size: 13px; color: #7a6c5d; margin: 0 0 10px; }
  .wrap { position: relative; }
  .map { width: 100%; height: 70vh; border-radius: 10px; overflow: hidden; border: 1px solid #e6ddd1; }
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
