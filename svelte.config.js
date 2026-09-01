import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Cloudflare Workers/Pages 向け。ページ単位で prerender / SSR を選べる
    adapter: adapter({
      // 全ページを事前生成しているため Functions は使わない。
      // 既定だと除外ルールが上限(100)を超え、静的ファイルまで Functions を
      // 経由してしまい無駄な呼び出しが発生する。
      routes: { include: ['/*'], exclude: ['/*'] },
    }),
    prerender: {
      // 出没個別ページなど大量のリンクは辿らせない（SSRで返す）
      crawl: true,
      handleHttpError: 'warn',
    },
  },
};
