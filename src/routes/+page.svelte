<script lang="ts">
  let { data } = $props();
  const idx = data.idx;
  const top = idx.prefs.slice(0, 12);
  const title = `クママップ｜全国のクマ出没情報・目撃マップ（${idx.total.toLocaleString()}件）`;
  const desc = `全国${idx.prefs.length}都道府県のクマ（熊）出没・目撃情報${idx.total.toLocaleString()}件を地図と一覧で掲載。自治体・警察の公開オープンデータを毎日更新しています。`;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={desc} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={desc} />
</svelte:head>

<h1>全国のクマ出没情報マップ</h1>
<p class="lead">
  自治体・警察が公開するオープンデータを集約し、<strong>{idx.prefs.length}都道府県・{idx.total.toLocaleString()}件</strong>の
  クマ（熊）の出没・目撃情報を掲載しています。毎日自動で更新しています。
</p>

<p><a class="cta" href="/map/">地図で見る</a></p>

<h2>出没件数の多い都道府県</h2>
<ul class="prefs">
  {#each top as p}
    <li><a href="/pref/{p.slug}/">{p.pref}</a><span>{p.count.toLocaleString()}件</span></li>
  {/each}
</ul>
<p><a href="/pref/">すべての都道府県を見る →</a></p>

<h2>このサイトについて</h2>
<p>
  掲載データは各都道府県・市区町村・警察が公開するオープンデータに基づいています。
  報道や未確認の投稿は含めておらず、出典が明確な情報のみを収録しています。
  すべての出没を網羅するものではないため、実際の行動判断は自治体の最新情報をご確認ください。
</p>

<style>
  h1 { font-size: 27px; margin: 6px 0 16px; }
  h2 { font-size: 18px; margin: 32px 0 10px; border-left: 4px solid #8a4d2b; padding-left: 10px; }
  .lead { font-size: 15.5px; }
  .cta { display: inline-block; background: #8a4d2b; color: #fff; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 700; }
  .prefs { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; }
  .prefs li { display: flex; justify-content: space-between; background: #fff; border: 1px solid #e6ddd1; border-radius: 8px; padding: 10px 14px; }
  .prefs a { color: #8a4d2b; font-weight: 700; text-decoration: none; }
  .prefs span { color: #5a4f44; font-size: 13px; font-variant-numeric: tabular-nums; }
</style>
