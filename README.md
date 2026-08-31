# クママップ (kmap)

自治体の**公開オープンデータ**を集約した、クマ出没情報マップ。全国対応を段階的に拡張していくMVP。

- 地図: MapLibre GL JS + 国土地理院タイル（無料・APIキー不要）
- データ: Node製ETL → `public/data/sightings.geojson`（静的配信）
- ホスティング: 静的サイトなので Cloudflare Pages / GitHub Pages 等に**0円**で公開可能

現在のデータ源（一次ソース）: **29都道府県・計 91,623件**（重複除去後）。取込方式は9種（CSV / ArcGIS FeatureServer / Google My Maps KML / Shapefile / JSON API / 静的GeoJSON / HTML埋め込みJSON / gzip TSV / TSV）。

| 都道府県 | 取得方式 | 件数 |
|---|---|---|
| 秋田県 | CSV（クマダス） | 21,915 |
| 北海道 | ひぐまっぷ(65市町村×全年度)＋札幌CSV(2017-)＋石狩/室蘭/小清水 | 14,030 |
| 新潟県 | ArcGIS（2017-2024＋R7-R8＋人身被害）＋県警TSV | 13,189 |
| 岩手県 | Bears(県公式全県)＋市町村My Maps＋宮古RakuLog | 7,549 |
| 岐阜県 | Shapefile（H26〜R7 全年度・系VII変換） | 6,134 |
| 富山県 | ArcGIS（クマっぷ） | 4,614 |
| 福島県 | ArcGIS | 4,487 |
| 宮城県 | Google My Maps KML | 3,523 |
| 山形県 | Google My Maps KML | 3,093 |
| 石川県 | CKAN CSV（R7＋R1-R6分析マップ） | 2,878 |
| 群馬県 | ArcGIS（Survey123） | 1,737 |
| 鳥取県 | 静的GeoJSON（geolonia・H30〜R7） | 1,553 |
| 長野県 | 県警TSV（県全域）＋市町村10箇所（上田/小諸/岡谷/茅野/富士見/原村/坂城/軽井沢/御代田/飯田） | 1,933 |
| 山口県 | CKAN CSV（2023-2026） | 1,233 |
| 栃木県 | 県警TSV.gz（県全域）＋那須塩原/那須/矢板 My Maps | 985 |
| 兵庫県 | JSON API（県警安全安心マップ） | 451 |
| 東京都 | sharp9110 オープンデータJSON | 384 |
| 埼玉県 | ArcGIS + CSV | 371 |
| 静岡県 | Google My Maps KML | 275 |
| 奈良県 | ArcGIS（2フォーム） | 243 |
| 山梨県 | CKAN DataStore API | 215 |
| 滋賀県 | 大津市・高島市 My Maps | 206 |
| 福井県 | HTML埋め込みJSON（FBI） | 198 |
| 三重県 | ArcGIS | 113 |
| 岡山県 | Google My Maps KML | 106 |
| 島根県 | 邑南町 My Maps | 90 |
| 青森県 | JSON API（くまログ） | 70 |
| 神奈川県 | 秦野市・松田町 My Maps | 45 |
| 和歌山県 | 有田川町 My Maps | 3 |

> データ源の全国棚卸し（47都道府県の取得可否）は別途調査済み。**県レベルでPDFしか無くても市町村が個別に
> Google マイマップ等で公開している例が多い**（栃木・滋賀・神奈川・島根・和歌山はこの経路で取得）。
> 現時点で座標付きデータが確認できなかったのは **広島県**（県・県警・主要市町を全ページ走査して皆無）と
> **愛知県**（豊田市はJPG画像のみ。三河山間部に限定・絶滅危惧IA類）のみ。
> 長野県は県が「けものおと2」(ログイン制)に閉じているが、**県警の事件事故マップ**から県全域を取得できる。
> 生息僅少・なし＝千葉・大阪・四国大半・九州・沖縄ほか。
>
> 岩手県は県レベルでは集計PDFのみだが、県公式のクマ出没共有システム **Bears**（`bears8.com/iwate/reports/map?area_city_id=3`＝全県）が無認証でHTMLに座標付きデータを埋め込んでおり、そこから取得している。市町村個別のGoogle My Maps（盛岡・雫石・金ケ崎・久慈・洋野・岩泉）と宮古市RakuLogも併用。**同一出没が複数ソースに載るため、県＋日付＋座標(4桁)での重複除去を実施**。
>
> 北海道は道全体の単一データが無く、**ひぐまっぷ**（65市町村が使う共通システム）から
> `higumap.info/map/reportsJson?cityId=<id>&fiscalYear=<年度>` で市町村別・年度別に取得する。
> `/recent/reportsJson` は直近3ヶ月しか返さないので使わない。**無効なcityIdは全道データを返す**ため、
> 必ず公式の市町村リスト（`/public/json/getTopPageCityList`）のIDだけを使うこと。
>
> **県警マップは有力な経路**だが、パスがベンダー実装で異なる。栃木は `/data/map/animal2.tsv.gz`（`.tsv`は404）、
> 長野・新潟は `/data/tsv/animal_full.tsv`。見つからない場合はSPAのJSバンドルから `data/tsv` 等のパス生成を探すこと。
> 長野・新潟の県警データは**直近12ヶ月のローリング**なので、アーカイブ統合で履歴を積む前提。
>
> robots.txt で収集を拒否しているサイト（岩手日報・山陰中央新報・kuma-watch.jp ほか）からは取得していない。
>
> 東京都は都のCSV/GPXがJS描画でURLを取れないが、汎用投稿システムのオープンデータ
> （`public.sharp9110.com/view/opendatajson/bear`、23,389件・複数県）から取得している。
> KML由来の日付は年が欠落しており一部欠損（点の表示には影響なし）。

## 開発

```bash
npm install
npm run data     # 一次ソースを取得して GeoJSON を生成
npm run habitat  # 環境省のクマ生息分布メッシュを取得（頻繁な更新は不要）
npm run dev      # http://localhost:5173
npm run build    # dist/ に静的ビルド
```

## 表示モード・機能

- **出没地点（点）**: 個々の出没をクラスタ表示。クリックで日時・場所・状況。
- **リスクマップ（2kmメッシュ）**: 出没点を約2kmグリッドに集計し、密度を5段階で色分け。
  緯度に応じて経度幅を補正（`MESH_KM / (111 * cos(lat))`）。クリックでセル内件数。
  現在の絞り込み（都道府県・期間）に連動してブラウザ側で再集計する。
- **県別集計（色分け）**: 47都道府県ポリゴンを取込件数で色分け（コロプレス）。
  未取込の県は「データ未整備」（淡色）。全国の公式な機械可読カウントは存在しない
  （環境省は前年度PDF・グラフのみ）ため、点データを増やすほど自動的に塗り分けが広がる設計。
- **生息分布レイヤー**（チェックボックス): 環境省「2019 クマ類全国分布メッシュ」(5km・17,068件)を
  背景に重ねる。`npm run habitat` で `public/data/habitat.geojson` を再生成（生2.8MB／gzip 0.2MB）。
- **統計パネル**: 月別の出没件数グラフ、都道府県・市町村の上位5件。絞り込みに連動。
- **多言語**: 日本語 / English を切替（`src/main.ts` の `I18N`）。初期値はブラウザ言語。

県境ポリゴンは [dataofjapan/land](https://github.com/dataofjapan/land)（`japan.geojson`）を
`mapshaper` で簡略化して生成（`public/data/prefectures.geojson` 40KB、ラベル用重心
`public/data/pref-points.geojson`）。再生成コマンドは下記。

```bash
# 塗り用（2%簡略化）
npx mapshaper japan.geojson -simplify 2% keep-shapes \
  -filter-fields id,nam_ja -o precision=0.001 public/data/prefectures.geojson
# ラベル用（県ごと内部重心）
npx mapshaper japan.geojson -filter-fields id,nam_ja -points inner \
  -o precision=0.001 public/data/pref-points.geojson
```

## データ源の追加

`scripts/fetch-data.mjs` の `SOURCES` 配列に1件足すだけ。8種別に対応:

- `type: 'csv'` … CSVのURL。`map(row)` が1行を共通スキーマに変換（`lat`/`lon` を含める）。`encoding: 'shift_jis'` 指定可
- `type: 'arcgis'` … ArcGIS FeatureServer層のURL。`map(props)` は属性→スキーマ変換のみ（座標はGeometryから、maxRecordCount上限1000でページング）
- `type: 'kml'` … Google My Maps の `forcekml=1` URL。Placemarkから座標・name・descriptionを抽出（`kmlSrc()` ヘルパー）
- `type: 'shpzip'` … Shapefile(zip)。shpjsで解析。投影座標なら `proj:` にproj4定義を渡すと変換（岐阜=平面直角VII）
- `type: 'json'` … JSON API。`array(data)` で配列を取り出し、`map(row)` が `lat`/`lon` を返す（兵庫県警・青森くまログ・山梨CKAN・ひぐまっぷ）
- `type: 'geojson'` … 静的GeoJSONのURL。`map(props)`（座標はGeometryから）（鳥取geolonia）
- `type: 'htmljson'` … HTMLに埋め込まれたJSON。`extract(html)` で配列を取り出す（福井FBI・岩手Bears・宮古RakuLog）
- `type: 'tsvgz'` … gzip圧縮TSV。ヘッダ無しで列インデックス参照（栃木県警。`.tsv` は404で `.tsv.gz` のみ）
- `type: 'tsv'` … 素のTSV。ヘッダ無しで列インデックス参照（長野・新潟県警。列の並びは県ごとに違う）
- `type: 'custom'` … 複数リクエストが必要な場合に `fetch()` を自前実装（ひぐまっぷの市町村×年度）

共通スキーマ: `{id, pref, city, date, species, kind, note}`（csvは加えて`lat, lon`）。
クマ類のみ抽出（`isBear`）・生息域内の座標のみ採用（`inJapan`、緯度33.0未満は座標誤りとして除外）・座標は5桁に丸め。
日付は `parseDate()` が epoch / 和暦（R7.8.5・令和8年1月4日）/ ISO・スラッシュ・ドット / 自由文の年月日を吸収。

ArcGISダッシュボード型のサイトは、ダッシュボード item の `/data?f=json` → 参照WebMap →
operationalLayers の FeatureServer URL を辿ると層URLが得られる。

### 取得の堅牢化

- **リトライ**: 403/429/5xx とネットワーク断（`fetch failed`）は指数バックオフで最大4回再試行。
  BODIK（京都）は短時間の連続アクセスで403を返すため、これが無いと丸ごと欠落する。
- **失敗の可視化**: 取得できなかったソースは実行末尾に警告として一覧表示する。
  データが黙って欠けたまま公開されるのを防ぐため、ここが空であることを確認してからデプロイする。
- **重複除去**: まず `id`（取得元ごとに決定的）で一意化し、次に「県＋日付(日単位)＋座標(小数4桁≒11m)」で
  別ソースの同一出没を寄せる。**id を第一キーにするのは必須**で、これが無いと日付を持たないレコード
  （岐阜・山形・岡山・宮城）がアーカイブ統合のたびに倍増する。
- **アーカイブ統合**: ひぐまっぷ・青森くまログ・山梨・福井は「現行分しか返さない」API のため、
  実行のたびに古い分が消える。前回の `sightings.geojson` を読んで統合し履歴を積み上げる。
  日次CIで自動的にデータが厚くなる。大配列の `push(...arr)` はスタック超過するので逐次 push すること。

## 公開（デプロイ）

**Cloudflare Pages（推奨・無料）**
1. GitHubにpush
2. Cloudflare Pages で当リポジトリを連携
3. Build command: `npm run build` / Output: `dist`

`.github/workflows/update-data.yml` が毎日 06:00 JST に一次ソースを再取得し、
差分があれば自動コミット → Pagesが再デプロイ。

## 今後の拡張（設計済みの方針）

- データ量が増えたら GeoJSON → **PMTiles**（ベクタタイル）化して配信軽量化（生27MB到達で優先度高）
- **投稿・認証**（Supabase Auth + RLS、承認フロー）— 公式データが無い県を埋める唯一の手段
- **多言語の追加**（ko/zh/th）、**ネイティブアプリ**（iOS/Android は MapLibre Native + 同一API）
- 京都府の2019年度以降（現在のBODIK CSVは2009-2018で止まっている）
- 岐阜のSHPはDBFがShift_JISで文字化けし日付・市町村を捨てている（手動デコードで復元可能）
