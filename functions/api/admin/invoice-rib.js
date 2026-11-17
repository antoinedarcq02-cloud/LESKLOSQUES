import {authorize,respond} from "../../_lib/admin-auth.js";
import {
  INVOICE_RIB_FILENAME,INVOICE_RIB_MAX_BYTES,
  ensureInvoiceRibTable,getInvoiceRib,encodeRibPdf,decodeRibPdf
} from "../../_lib/invoice-rib.js";

async function requireManager(context,write=false){
  const access=await authorize(context,write);
  if(access.error)return access;
  if(access.user?.role!=="admin")
    return {error:respond({error:"Gestion du RIB réservée au responsable."},403)};
  return access;
}

export async function onRequestGet(context){
  const user=await requireManager(context);
  if(user.error)return user.error;
  try{
    const rib=await getInvoiceRib(context.env.DB);
    const query=new URL(context.request.url).searchParams;
    if(query.get("download")==="1"){
      if(!rib)return respond({error:"Aucun RIB enregistré."},404);
      const bytes=decodeRibPdf(rib.content);
      return new Response(bytes,{headers:{
        "Content-Type":"application/pdf",
        "Content-Disposition":'attachment; filename="'+INVOICE_RIB_FILENAME+'"',
        "Cache-Control":"private, no-store",
        "X-Content-Type-Options":"nosniff"
      }});
    }
    return respond({configured:!!rib,filename:rib?.filename||null,
      size_bytes:rib?.size_bytes||0,updated_at:rib?.updated_at||null});
  }catch(error){
    console.warn("Consultation RIB indisponible",error?.message);
    return respond({error:"Impossible de consulter le RIB."},503);
  }
}

export async function onRequestPost(context){
  const user=await requireManager(context,true);
  if(user.error)return user.error;
  const type=String(context.request.headers.get("Content-Type")||"").split(";")[0].trim().toLowerCase();
  if(type!=="application/pdf")
    return respond({error:"Sélectionne un document au format PDF."},415);
  const announced=Number(context.request.headers.get("Content-Length")||0);
  if(announced>INVOICE_RIB_MAX_BYTES)
    return respond({error:"Le RIB dépasse 1,35 Mo. Choisis un PDF optimisé."},413);
  try{
    const bytes=new Uint8Array(await context.request.arrayBuffer());
    if(bytes.length<100||bytes.length>INVOICE_RIB_MAX_BYTES)
      return respond({error:"Le RIB doit être un PDF de 1,35 Mo maximum."},413);
    const start=String.fromCharCode(...bytes.subarray(0,8));
    const end=String.fromCharCode(...bytes.subarray(Math.max(0,bytes.length-2048)));
    if(!start.startsWith("%PDF-")||!end.includes("%%EOF"))
      return respond({error:"Ce fichier ne semble pas être un PDF valide."},400);
    const base64=encodeRibPdf(bytes);
    await ensureInvoiceRibTable(context.env.DB);
    await context.env.DB.prepare(`INSERT INTO invoice_rib_attachment(
      id,pdf_base64,size_bytes,updated_by,updated_at
    ) VALUES(1,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      pdf_base64=excluded.pdf_base64,size_bytes=excluded.size_bytes,
      updated_by=excluded.updated_by,updated_at=datetime('now')`)
      .bind(base64,bytes.length,user.email).run();
    return respond({ok:true,configured:true,filename:INVOICE_RIB_FILENAME,
      size_bytes:bytes.length});
  }catch(error){
    console.warn("Enregistrement RIB impossible",error?.message);
    return respond({error:"Enregistrement du RIB impossible. Vérifie la base privée."},503);
  }
}

export async function onRequestDelete(context){
  const user=await requireManager(context,true);
  if(user.error)return user.error;
  let confirmation;
  try{confirmation=await context.request.json();}catch{}
  if(confirmation?.confirm!==true)
    return respond({error:"Confirme la suppression du RIB."},400);
  try{
    await ensureInvoiceRibTable(context.env.DB);
    await context.env.DB.prepare("DELETE FROM invoice_rib_attachment WHERE id=1").run();
    return respond({ok:true,configured:false});
  }catch(error){
    console.warn("Suppression RIB impossible",error?.message);
    return respond({error:"Impossible de supprimer le RIB."},503);
  }
}
