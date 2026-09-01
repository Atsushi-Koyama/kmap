<script lang="ts">
  import { formatDate } from '$lib/data';
  let { data } = $props();
  const p = data.page;

  // 統計はビルド時に全件から計算済み（表示用の500件から出すと数字が誤る）
  const st = p.stats;
  const months = st.months;
  const peak = st.peak;
  const d30 = st.d30;
  const latest = st.latest;

  const title = `${p.pref}のクマ出没情報 ${p.count.toLocaleString()}件｜最新の目撃マップ - クママップ`;
  const desc =
    `${p.pref}のクマ（熊）出没・目撃情報を地図と一覧で掲載。` +
    `自治体の公開データをもとに${p.count.toLocaleString()}件を収録し、直近30日は${d30}件。` +
    `${p.cities.length > 0 ? `${p.cities.slice(0, 3).map((c) => c.name).join('・')}など市区町村別にも確認できます。` : ''}`;
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={desc} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={desc} />
  <meta property="og:type" content="website" />
  {@html `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: `${p.pref}のクマ出没情報`,
    description: desc,
    spatialCoverage: p.pref,
    creator: { '@type': 'Organization', name: 'クママップ' },
    isAccessibleForFree: true,
  })}<\/script>`}
</svelte:head>

<nav class="crumbs"><a href="/">ホーム</a> › <a href="/pref/">都道府県</a> › {p.pref}</nav>

<h1>{p.pref}のクマ出没情報</h1>

<div class="stats">
  <div class="stat"><b>{p.count.toLocaleString()}</b><span>収録件数</span></div>
  <div class="stat"><b>{d30}</b><span>直近30日</span></div>
  <div class="stat"><b>{peak}月</b><span>最も多い月</span></div>
  <div class="stat"><b>{p.cities.length}</b><span>市区町村</span></div>
</div>

<p class="lead">
  {p.pref}では、自治体などの公開データをもとに<strong>{p.count.toLocaleString()}件</strong>のクマ（熊）の
  出没・目撃情報を収録しています。出没は<strong>{peak}月</strong>に最も多く、直近30日では{d30}件が確認されています。
  {#if latest}最新の記録は{formatDate(latest)}です。{/if}
</p>

{#if p.cities.length}
  <h2>{p.pref}の市区町村別 出没情報</h2>
  <ul class="cities">
    {#each p.cities as c}
      <li><a href="/pref/{p.slug}/{c.slug}/">{c.name}</a><span>{c.count.toLocaleString()}件</span></li>
    {/each}
  </ul>
{/if}

<h2>月別の出没件数</h2>
<ul class="months">
  {#each months as n, i}
    <li>
      <span class="m">{i + 1}月</span>
      <span class="bar" style="width:{(n / Math.max(...months, 1)) * 100}%"></span>
      <span class="v">{n.toLocaleString()}</span>
    </li>
  {/each}
</ul>
<p class="note">※ 収録{p.count.toLocaleString()}件すべてをもとに集計（直近1年: {st.d365.toLocaleString()}件）</p>

<h2>最近の出没記録</h2>
<ol class="list">
  {#each p.items.slice(0, 60) as r}
    <li>
      <time>{formatDate(r.d)}</time>
      <span class="place">{r.c ?? p.pref}{#if r.k}・{r.k}{/if}</span>
      {#if r.n}<p>{r.n}</p>{/if}
    </li>
  {/each}
</ol>

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
  .cities { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 6px; }
  .cities li { display: flex; justify-content: space-between; background: #fff; border: 1px solid #e6ddd1; border-radius: 8px; padding: 8px 12px; font-size: 14px; }
  .cities a { color: #8a4d2b; text-decoration: none; font-weight: 600; }
  .cities span { color: #7a6c5d; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .months { list-style: none; padding: 0; }
  .months li { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
  .months .m { width: 34px; color: #7a6c5d; }
  .months .bar { height: 10px; background: #d98d4f; border-radius: 3px; min-width: 2px; }
  .months .v { color: #5a4f44; font-variant-numeric: tabular-nums; }
  .note { font-size: 11.5px; color: #9a8d7e; }
  .list { padding-left: 18px; }
  .list li { margin-bottom: 12px; }
  .list time { font-weight: 700; color: #8a4d2b; font-size: 13.5px; }
  .list .place { margin-left: 8px; font-size: 13px; color: #5a4f44; }
  .list p { margin: 2px 0 0; font-size: 13.5px; color: #4a4038; }
</style>
