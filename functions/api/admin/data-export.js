import {authorize} from "../../_lib/admin-auth.js";

// Export manuel des dossiers administratifs. Ne contient jamais
// les mots de passe, secrets OAuth, autorisations de messagerie ou RIB.
// Ce fichier est une archive lisible, PAS une sauvegarde D1 restaurable
// en un clic. Une restauration technique relève de Cloudflare D1 Time Travel.
const TABLES=[
  "bookings","site_content",
  "official_quotes","quote_email_sends",
  "official_invoices","invoice_sequence","invoice_email_sends","invoice_archives",
  "booking_email_logs","google_concert_links"
];
const PAGE_SIZE=200;
const MAX_ROWS_PER_TABLE=20000;

function fail(message,status=503){
  return Response.json({error:message},{
    status,headers:{"Cache-Control":"private, no-store"}
  });
}

export async function onRequestGet(context){
  const access=await authorize(context);
  if(access.error)return access.error;
  if(access.user?.role!=="admin")
    return fail("Export réservé au gestionnaire.",403);
  try{
    const DB=context.env.DB;
    const metadata=await DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+
      TABLES.map(()=>"?").join(",")+")"
    ).bind(...TABLES).all();
    const available=new Set((metadata.results||[]).map(row=>row.name));
    const snapshot={
      format:"klosques-manager-archive-v1",
      exported_at:new Date().toISOString(),
      contains_private_client_data:true,
      excludes:"identifiants, secrets de connexion, RIB bancaire et tokens OAuth",
      purpose:"Archive administrative manuelle ; une restauration complète se fait via Cloudflare D1.",
      tables:{}
    };
    for(const table of TABLES){
      if(!available.has(table))continue;
      // Le nom SQL provient exclusivement de la liste fixe ci-dessus.
      const rows=[];
      for(let offset=0;;offset+=PAGE_SIZE){
        const page=await DB.prepare(
          "SELECT * FROM "+table+" ORDER BY rowid LIMIT ? OFFSET ?"
        ).bind(PAGE_SIZE,offset).all();
        const chunk=page.results||[];
        rows.push(...chunk);
        if(rows.length>MAX_ROWS_PER_TABLE)
          return fail("Export trop volumineux : certaines données dépassent la limite. Utilise une sauvegarde D1 complète.",413);
        if(chunk.length<PAGE_SIZE)break;
      }
      snapshot.tables[table]=rows;
    }
    const date=new Date().toISOString().slice(0,10);
    return new Response(JSON.stringify(snapshot),{
      status:200,
      headers:{
        "Content-Type":"application/json; charset=utf-8",
        "Content-Disposition":'attachment; filename="klosques-archive-'+date+'.json"',
        "Cache-Control":"private, no-store",
        "Pragma":"no-cache",
        "X-Content-Type-Options":"nosniff",
        "Referrer-Policy":"no-referrer"
      }
    });
  }catch(error){
    console.warn("Export administratif impossible",error?.message);
    return fail("Impossible de préparer l’export. Aucune donnée n’a été supprimée.");
  }
}
