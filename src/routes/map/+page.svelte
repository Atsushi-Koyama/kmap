<script lang="ts">
  import { onMount } from 'svelte';
  let { data } = $props();
  const total = data.total;
  let el: HTMLDivElement;
  // 地図が使える状態になるまで枠内に出す表示。件数はSSGのHTMLに焼かれているので待たせない。
  let status = $state('地図を読み込み中…');

  onMount(async () => {
    const maplibregl = (await import('maplibre-gl')).default;
    await import('maplibre-gl/dist/maplibre-gl.css');
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
        },
        layers: [{ id: 'gsi', type: 'raster', source: 'gsi' }],
      },
      center: [137.5, 37.4],
      zoom: 4.7,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('error', (e) => { status = '地図を読み込めませんでした'; console.error(e?.error ?? e); });
    map.on('load', () => {
      status = '出没地点を読み込み中…';

      // data は「オブジェクト」ではなく「URL」を渡すこと。URL ならワーカー側で
      // fetch・パース・クラスタリングが走る。オブジェクトを渡すと 10万件の
      // 転送がメインスレッドを数秒ブロックし、地図が真っ白のまま固まる。
      map.addSource('s', {
        type: 'geojson', data: '/api/points.geojson',
        cluster: true, clusterRadius: 50, clusterMaxZoom: 12,
      });
      map.addLayer({
        id: 'clusters', type: 'circle', source: 's', filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#f1a340', 50, '#e08214', 200, '#b35806'],
          'circle-radius': ['step', ['get', 'point_count'], 16, 50, 22, 200, 30],
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 's', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': '#fff' },
      });
      map.addLayer({
        id: 'points', type: 'circle', source: 's', filter: ['!', ['has', 'point_count']],
        paint: { 'circle-color': '#b35806', 'circle-radius': 6, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff' },
      });
      map.on('sourcedata', (e) => {
        if (e.sourceId === 's' && map.isSourceLoaded('s')) status = '';
      });
    });
  });
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
