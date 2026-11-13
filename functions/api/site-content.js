// Valeurs publiques uniquement : aucune information client ni compte personnel.
export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ content: {} }, { headers: { "Cache-Control": "no-store" } });
  try {
    const { results } = await env.DB.prepare("SELECT key,value FROM site_content").all();
    return Response.json({ content: Object.fromEntries((results || []).map(row => [row.key,row.value])) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ content: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}
