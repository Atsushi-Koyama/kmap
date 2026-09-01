import { error } from '@sveltejs/kit';
import type { Index, CityPage } from '$lib/data';

export const prerender = true;

// 生成する市区町村ページを列挙（20件以上のものだけ build-pages.mjs が出力している）
export async function entries() {
  const idx: Index = (await import('../../../../../static/api/index.json')).default as Index;
  return idx.prefs.flatMap((p) => p.cities.map((c) => ({ slug: p.slug, city: c.slug })));
}

export async function load({ params, fetch }) {
  const res = await fetch(`/api/city/${params.city}.json`);
  if (!res.ok) throw error(404, 'ページが見つかりません');
  const data: CityPage = await res.json();
  if (data.prefSlug !== params.slug) throw error(404, 'ページが見つかりません');
  return { page: data };
}
