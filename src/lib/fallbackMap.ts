// WebGL が使えない環境向けの代替地図。canvas 2D だけで日本地図と出没点を描く。
// maplibre は WebGL 必須なので、GPUが無い・コンテキスト上限に達した端末では
// 地図が一切出せない。そこを「一覧へのリンク」で済ませると、地図サイトとして
// 成立しないため、簡易でも地図を出す。

type Pt = [number, number];

// 日本全体が収まる範囲。ここに固定して単純な線形投影で描く
const BBOX = { minLon: 127, maxLon: 146.5, minLat: 30.5, maxLat: 45.8 };

export async function renderFallbackMap(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // 縦横比を保ったまま収める
  const sx = w / (BBOX.maxLon - BBOX.minLon);
  const sy = h / (BBOX.maxLat - BBOX.minLat);
  const s = Math.min(sx, sy);
  const ox = (w - (BBOX.maxLon - BBOX.minLon) * s) / 2;
  const oy = (h - (BBOX.maxLat - BBOX.minLat) * s) / 2;
  const px = (lon: number) => ox + (lon - BBOX.minLon) * s;
  const py = (lat: number) => oy + (BBOX.maxLat - lat) * s;

  ctx.fillStyle = '#dfe9f3';
  ctx.fillRect(0, 0, w, h);

  // 県境
  try {
    const geo = await (await fetch('/api/prefectures.geojson')).json();
    ctx.fillStyle = '#f6f2ea';
    ctx.strokeStyle = '#c3b7a6';
    ctx.lineWidth = 0.6;
    for (const f of geo.features ?? []) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          ctx.beginPath();
          ring.forEach(([lon, lat]: Pt, i: number) => {
            const x = px(lon), y = py(lat);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  } catch { /* 県境が無くても点だけは出す */ }

  // 出没点。10万点をそのまま打つと重いので、画面上の格子に丸めて間引く
  try {
    const geo = await (await fetch('/api/points.geojson')).json();
    const seen = new Set<string>();
    const cell = 2; // px
    ctx.fillStyle = 'rgba(179, 88, 6, 0.75)';
    for (const f of geo.features ?? []) {
      const [lon, lat] = f.geometry.coordinates;
      const x = Math.round(px(lon) / cell) * cell;
      const y = Math.round(py(lat) / cell) * cell;
      const key = `${x}:${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      ctx.fillRect(x - 1, y - 1, 2.5, 2.5);
    }
  } catch { /* 取得できなければ地図だけ表示 */ }
}
