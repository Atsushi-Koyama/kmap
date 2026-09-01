<script lang="ts">
  let { data } = $props();
  const idx = data.idx;
  const title = `都道府県別のクマ出没情報一覧｜${idx.total.toLocaleString()}件 - クママップ`;
  const desc = `全国${idx.prefs.length}都道府県のクマ（熊）出没・目撃情報を収録。合計${idx.total.toLocaleString()}件を都道府県・市区町村別に確認できます。`;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={desc} />
</svelte:head>

<nav class="crumbs"><a href="/">ホーム</a> › 都道府県</nav>
<h1>都道府県別のクマ出没情報</h1>
<p class="lead">
  自治体・警察の公開データをもとに、<strong>{idx.prefs.length}都道府県・{idx.total.toLocaleString()}件</strong>の
  クマ（熊）出没情報を収録しています。件数の多い順に掲載しています。
</p>

<ul class="prefs">
  {#each idx.prefs as p}
    <li>
      <a href="/pref/{p.slug}/">{p.pref}</a>
      <span>{p.count.toLocaleString()}件</span>
      {#if p.cities.length}<em>{p.cities.length}市区町村</em>{/if}
    </li>
  {/each}
</ul>

<style>
  .crumbs { font-size: 12.5px; color: #7a6c5d; margin-bottom: 10px; }
  .crumbs a { color: #8a4d2b; }
  h1 { font-size: 26px; margin: 6px 0 16px; }
  .lead { font-size: 15px; }
  .prefs { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; }
  .prefs li { display: flex; align-items: baseline; gap: 8px; background: #fff; border: 1px solid #e6ddd1; border-radius: 8px; padding: 10px 14px; }
  .prefs a { color: #8a4d2b; font-weight: 700; text-decoration: none; }
  .prefs span { color: #5a4f44; font-size: 13px; font-variant-numeric: tabular-nums; }
  .prefs em { margin-left: auto; font-style: normal; color: #9a8d7e; font-size: 11.5px; }
</style>
