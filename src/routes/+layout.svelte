<script lang="ts">
  let { children } = $props();
</script>

<header>
  <a class="brand" href="/">🐻 クママップ</a>
  <span class="tag">全国のクマ出没情報</span>
</header>

<main>{@render children()}</main>

<footer>
  <p>
    出典: 各自治体・警察の公開オープンデータ。掲載内容は公表データに基づく参考情報で、
    すべての出没を網羅するものではありません。
  </p>
  <p><a href="/">全国マップ</a> ・ <a href="/pref">都道府県一覧</a></p>
</footer>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) {
    margin: 0; color: #1f1a15; background: #fbf8f4;
    font-family: -apple-system, "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
    line-height: 1.75;
  }
  header {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 18px; background: #7b4a2d; color: #fff;
  }
  .brand { color: #fff; font-weight: 700; font-size: 17px; text-decoration: none; }
  .tag { font-size: 12.5px; opacity: .9; }
  main { max-width: 900px; margin: 0 auto; padding: 22px 18px 60px; }
  footer {
    max-width: 900px; margin: 0 auto; padding: 22px 18px 40px;
    border-top: 1px solid #e6ddd1; font-size: 12.5px; color: #7a6c5d;
  }
  footer a { color: #8a4d2b; }
</style>
