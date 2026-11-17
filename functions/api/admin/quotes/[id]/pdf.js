import {authorize} from "../../../../_lib/admin-auth.js";
import {createQuotePdf} from "../../../../_lib/quote-pdf.js";
import {ensureQuotesTable} from "../../../../_lib/quote-table.js";

// Le PDF consulté est généré exactement par le moteur de la pièce jointe
// envoyée au client. Une session authentifiée reste obligatoire.
export async function onRequestGet(context){
  const user=await authorize(context);
  if(user.error)return user.error;
  const rawId=context.params.id;
  if(!/^[1-9]\d{0,14}$/.test(rawId||"")||!Number.isSafeInteger(Number(rawId)))
    return new Response("Devis invalide.",{status:400});
  try{
    await ensureQuotesTable(context.env.DB);
    const row=await context.env.DB.prepare(
      "SELECT id,data_json,status,created_at FROM official_quotes WHERE id=?"
    ).bind(Number(rawId)).first();
    if(!row)return new Response("Devis introuvable.",{status:404});
    const number="DEV-"+row.created_at.slice(0,4)+"-"+String(row.id).padStart(5,"0");
    const pdf=createQuotePdf({number,status:row.status,data:JSON.parse(row.data_json)});
    const download=new URL(context.request.url).searchParams.get("download")==="1";
    return new Response(pdf,{headers:{
      "Content-Type":"application/pdf",
      "Content-Disposition":(download?"attachment":"inline")+'; filename="'+number+'.pdf"',
      "Cache-Control":"private, no-store",
      "X-Content-Type-Options":"nosniff"
    }});
  }catch(error){
    console.warn("Erreur génération PDF devis",error?.message);
    return new Response("Impossible de générer le devis PDF.",{status:503});
  }
}
