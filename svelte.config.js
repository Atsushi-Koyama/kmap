import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // Cloudflare Workers/Pages 向け。ページ単位で prerender / SSR を選べる
    adapter: adapter(),
    prerender: {
      // 出没個別ページなど大量のリンクは辿らせない（SSRで返す）
      crawl: true,
      handleHttpError: 'warn',
    },
  },
};
