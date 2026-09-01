// 地図本体（10万点）はクライアントで描くが、シェルと件数はSSGで先に出す。
// ssr=false にすると maplibre-gl（gzip 212KB）の読み込みと初期化が終わるまで
// 見出しすら描画されず、「読み込み中…」と空の枠だけの画面が数秒続いてしまう。
export const prerender = true;

export async function load({ fetch }) {
  const idx = await (await fetch('/api/index.json')).json();
  return {
    total: idx.total as number,
    generatedAt: idx.generatedAt as string,
    // フィルタ用。points.geojson の properties.p はこの配列の添字を指す
    prefs: idx.prefs as { pref: string; slug: string; count: number }[],
  };
}
