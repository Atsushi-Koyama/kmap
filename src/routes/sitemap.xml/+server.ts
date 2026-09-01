import type { Index } from '$lib/data';
import { SITE_URL } from '$lib/site';
import idxJson from '../../../static/api/index.json';

export const prerender = true;

export function GET() {
  const idx = idxJson as unknown as Index;
  const urls = [
    { loc: '/', pri: '1.0' },
    { loc: '/map/', pri: '0.8' },
    { loc: '/pref/', pri: '0.9' },
    ...idx.prefs.map((p) => ({ loc: `/pref/${p.slug}/`, pri: '0.8' })),
    ...idx.prefs.flatMap((p) => p.cities.map((c) => ({ loc: `/pref/${p.slug}/${c.slug}/`, pri: '0.7' }))),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE_URL}${u.loc}</loc><priority>${u.pri}</priority></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
