import { error } from '@sveltejs/kit';
import type { Index, PrefPage } from '$lib/data';

export const prerender = true;

// 生成する都道府県ページを列挙する（データがある県だけ）
export async function entries() {
  const idx: Index = (await import('../../../../static/api/index.json')).default as Index;
  return idx.prefs.map((p) => ({ slug: p.slug }));
}

export async function load({ params, fetch }) {
  const res = await fetch(`/api/pref/${params.slug}.json`);
  if (!res.ok) throw error(404, 'ページが見つかりません');
  const data: PrefPage = await res.json();
  return { page: data };
}
