// 地図は全点(30MB)を読むためクライアント側で描画する。
// 検索流入は地域ページが担うので、この1枚はSSGのシェルで足りる。
export const prerender = true;
export const ssr = false;
