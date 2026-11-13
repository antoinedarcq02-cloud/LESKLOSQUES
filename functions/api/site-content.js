// Valeurs publiques uniquement : aucune information client ni compte personnel.
export async function onRequestGet({ env }) {
  if (!env.DB) return Response.json({ content: {} }, { headers: { "Cache-Control": "no-store" } });
  try {
    // Ne jamais publier les profils de devis/facturation conservés dans site_content.
    const publicKeys=["hero_lead","hero_copy","intro_text","video_1","video_2","video_3","facebook_reel"];
    const marks=publicKeys.map(()=>"?").join(",");
    const { results } = await env.DB.prepare(
      "SELECT key,value FROM site_content WHERE key IN ("+marks+")"
    ).bind(...publicKeys).all();
    return Response.json({ content: Object.fromEntries((results || []).map(row => [row.key,row.value])) },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ content: {} }, { headers: { "Cache-Control": "no-store" } });
  }
}
