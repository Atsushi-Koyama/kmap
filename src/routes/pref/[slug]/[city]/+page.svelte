<script lang="ts">
  import { formatDate } from '$lib/data';
  let { data } = $props();
  const p = data.page;

  const st = p.stats;
  const peak = st.peak;
  const d30 = st.d30;
  const latest = st.latest;

  const title = `${p.city}のクマ出没情報 ${p.count.toLocaleString()}件｜最新の目撃マップ - クママップ`;
  const desc =
    `${p.pref}${p.city}のクマ（熊）出没・目撃情報。公開データをもとに${p.count.toLocaleString()}件を収録し、` +
    `直近30日は${d30}件。日時・場所・状況を一覧で確認できます。`;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={desc} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={desc} />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${p.pref}${p.city}のクマ出没情報`,
    description: desc,
    spatialCoverage: `${p.pref}${p.city}`,
    isAccessibleForFree: true,
  })}<\/script>`}
</svelte:head>

<nav class="crumbs">
  <a href="/">ホーム</a> › <a href="/pref/">都道府県</a> ›
  <a href="/pref/{p.prefSlug}/">{p.pref}</a> › {p.city}
</nav>

<h1>{p.city}のクマ出没情報</h1>

<div class="stats">
  <div class="stat"><b>{p.count.toLocaleString()}</b><span>収録件数</span></div>
  <div class="stat"><b>{d30}</b><span>直近30日</span></div>
  <div class="stat"><b>{peak}月</b><span>最も多い月</span></div>
</div>

<p class="lead">
  {p.pref}{p.city}では<strong>{p.count.toLocaleString()}件</strong>のクマ（熊）の出没・目撃情報を収録しています。
  出没は<strong>{peak}月</strong>に最も多く、直近30日では{d30}件。
  {#if latest}最新の記録は{formatDate(latest)}です。{/if}
</p>

<h2>{p.city}の出没記録</h2>
<ol class="list">
  {#each p.items.slice(0, 200) as r}
    <li>
      <time>{formatDate(r.d)}</time>
      {#if r.k}<span class="place">{r.k}</span>{/if}
      {#if r.n}<p>{r.n}</p>{/if}
    </li>
  {/each}
</ol>

<p><a href="/pref/{p.prefSlug}/">← {p.pref}全体の出没情報を見る</a></p>

<style>
  .crumbs { font-size: 12.5px; color: #7a6c5d; margin-bottom: 10px; }
  .crumbs a { color: #8a4d2b; }
  h1 { font-size: 26px; margin: 6px 0 16px; }
  h2 { font-size: 18px; margin: 32px 0 10px; border-left: 4px solid #8a4d2b; padding-left: 10px; }
  .lead { font-size: 15px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; margin: 16px 0 20px; }
  .stat { background: #fff; border: 1px solid #e6ddd1; border-radius: 10px; padding: 12px; text-align: center; }
  .stat b { display: block; font-size: 22px; color: #8a4d2b; font-variant-numeric: tabular-nums; }
  .stat span { font-size: 11.5px; color: #7a6c5d; }
  .list { padding-left: 18px; }
  .list li { margin-bottom: 12px; }
  .list time { font-weight: 700; color: #8a4d2b; font-size: 13.5px; }
  .list .place { margin-left: 8px; font-size: 13px; color: #5a4f44; }
  .list p { margin: 2px 0 0; font-size: 13.5px; color: #4a4038; }
</style>
