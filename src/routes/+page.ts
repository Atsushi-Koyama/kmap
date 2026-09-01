export const prerender = true;
export async function load({ fetch }) {
  const idx = await (await fetch('/api/index.json')).json();
  return { idx };
}
