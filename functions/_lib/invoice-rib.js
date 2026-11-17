// RIB des factures stocké dans D1 (privé), jamais publié dans les assets du site.
// La limite tient compte du maximum de 2 Mo par valeur dans Cloudflare D1.
export const INVOICE_RIB_FILENAME="RIB_Happy_Live_66.pdf";
export const INVOICE_RIB_MAX_BYTES=1350000;

export async function ensureInvoiceRibTable(DB){
  await DB.prepare(`CREATE TABLE IF NOT EXISTS invoice_rib_attachment (
    id INTEGER PRIMARY KEY CHECK(id=1),
    pdf_base64 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_by TEXT NOT NULL
  )`).run();
}

export async function getInvoiceRib(DB){
  await ensureInvoiceRibTable(DB);
  const row=await DB.prepare(
    "SELECT pdf_base64,size_bytes,updated_at FROM invoice_rib_attachment WHERE id=1"
  ).first();
  if(!row?.pdf_base64)return null;
  // Même nom de pièce jointe sur tous les envois.
  return {filename:INVOICE_RIB_FILENAME,content:row.pdf_base64,
    size_bytes:row.size_bytes,updated_at:row.updated_at};
}

export function encodeRibPdf(bytes){
  let binary="";
  for(let i=0;i<bytes.length;i+=16384)
    binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return btoa(binary);
}

export function decodeRibPdf(base64){
  const binary=atob(base64);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  return bytes;
}
