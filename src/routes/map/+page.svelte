<script lang="ts">
  import { onMount } from 'svelte';
  let { data } = $props();
  const total = data.total;
  let el: HTMLDivElement;
  // 枠内に出す読み込み表示。地図の描画が始まったら消すだけの飾りで、
  // ここに機能を載せない（描画イベントが来ない環境で地図ごと止まるため）。
  let status = $state('地図を読み込み中…');

  // 原因調査用。画面に出ない失敗を追えるようにする。
  const log: string[] = [];
  const mark = (m: string) => { log.push(`${Math.round(performance.now())}ms ${m}`); };

  onMount(async () => {
    // ここで throw すると status が初期値のまま固まり、画面上は
    // 「読み込み中」と区別が付かない。必ず理由を表示に出す。
    try {
      await boot();
    } catch (e) {
      status = `地図を初期化できませんでした: ${e instanceof Error ? e.message : String(e)}`;
      console.error('[kmap] 初期化失敗', e);
    }
    (window as any).__kmap = { log, status: () => status };
  });

  async function boot() {
    mark('boot開始');
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
            type: 'geojson', data: '/api/points.geojson',
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
    });
    mark('Map生成完了');
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
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
<p class="c">{total.toLocaleString()} 件</p>
<div class="wrap">
  <div class="map" bind:this={el}></div>
  {#if status}<p class="status">{status}</p>{/if}
</div>
<p><a href="/pref/">都道府県別の一覧を見る →</a></p>

<style>
  h1 { font-size: 22px; margin: 6px 0 8px; }
  .c { font-size: 13px; color: #7a6c5d; margin: 0 0 10px; }
  .wrap { position: relative; }
  .map { width: 100%; height: 70vh; border-radius: 10px; overflow: hidden; border: 1px solid #e6ddd1; }
  .status {
    position: absolute; inset: 0; margin: 0; display: flex;
    align-items: center; justify-content: center;
    font-size: 14px; color: #7a6c5d; pointer-events: none;
  }
</style>
