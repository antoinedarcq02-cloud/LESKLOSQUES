import { cleanText, validDate } from "./admin-auth.js";

const LIMITS = {
  issuer_name:160,issuer_address:350,issuer_identifier:90,issuer_tax_number:70,
  issuer_contact:180,issuer_legal:250,
  client_name:160,client_address:350,client_email:254,client_identifier:100,
  event_date:10,event_location:240,event_time:5,
  issue_date:10,payment_due_date:10,payment_terms:600,description:900,
  conditions:1400,late_penalties:250
};
const VAT=["non_precise","franchise","20","10","5.5","0"];
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export const validInvoiceId = id => typeof id==="string" && ID.test(id);
export function invoiceLocalDate(){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Paris",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const value=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return value.year+"-"+value.month+"-"+value.day;
}
export async function ensureInvoiceTables(DB){
  await DB.batch([
    DB.prepare("CREATE TABLE IF NOT EXISTS official_invoices (id TEXT PRIMARY KEY,booking_id TEXT,quote_id INTEGER,data_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'brouillon' CHECK(status IN ('brouillon','emise')),number INTEGER UNIQUE,issued_at TEXT,paid INTEGER NOT NULL DEFAULT 0 CHECK(paid IN (0,1)),paid_at TEXT,created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),updated_by TEXT NOT NULL)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS invoice_sequence (number INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id TEXT UNIQUE NOT NULL)"),
    DB.prepare("CREATE TABLE IF NOT EXISTS invoice_email_sends (id INTEGER PRIMARY KEY AUTOINCREMENT,invoice_id TEXT NOT NULL,recipient TEXT NOT NULL,provider TEXT NOT NULL,message_id TEXT,sent_by TEXT NOT NULL,sent_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    DB.prepare("CREATE TABLE IF NOT EXISTS invoice_archives (invoice_id TEXT PRIMARY KEY, archived INTEGER NOT NULL CHECK(archived IN (0,1)), archived_at TEXT, archived_by TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT (datetime('now')), changed_by TEXT NOT NULL)")
  ]);
}
export function parseInvoice(data){
  if(!data||typeof data!=="object"||Array.isArray(data))
    throw Error("Informations de facture invalides.");
  const result={};
  for(const [name,length] of Object.entries(LIMITS)){
    if(data[name]!=null&&typeof data[name]!=="string")
      throw Error("Champ incorrect : "+name);
    result[name]=cleanText(data[name],length);
  }
  result.client_type=data.client_type==="professionnel"?"professionnel":"particulier";
  if(!VAT.includes(data.vat_mode))throw Error("Choisis le régime de TVA.");
  result.vat_mode=data.vat_mode;
  if(result.client_email&&!EMAIL.test(result.client_email))throw Error("Adresse e-mail invalide.");
  for(const key of ["event_date","payment_due_date","issue_date"]){
    if(result[key]&&!validDate(result[key]))throw Error("Date invalide : "+key);
  }
  if(result.event_time&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result.event_time))
    throw Error("Heure invalide.");
  if(!Array.isArray(data.lines)||data.lines.length>12)
    throw Error("12 prestations au maximum.");
  result.lines=data.lines.map(line=>{
    if(!line||typeof line.label!=="string"||!Number.isFinite(line.qty)||
      line.qty<=0||line.qty>1000||!Number.isSafeInteger(line.price_cents)||
      line.price_cents<0||line.price_cents>100000000)
      throw Error("Vérifie les prestations et leurs tarifs.");
    return {label:cleanText(line.label,220),qty:line.qty,price_cents:line.price_cents};
  });
  const ht=result.lines.reduce((sum,l)=>sum+Math.round(l.price_cents*l.qty),0);
  if(!Number.isSafeInteger(ht)||ht>100000000)throw Error("Montant total trop élevé.");
  return result;
}
export function validateIssuance(data){
  const essential={
    issuer_name:"le nom de la structure émettrice",
    issuer_address:"l'adresse de la structure",
    issuer_identifier:"l'identifiant officiel de la structure",
    client_name:"le nom du client",
    client_address:"l'adresse du client",
    event_date:"la date de la prestation",
    event_location:"le lieu de la prestation",
    payment_due_date:"la date limite de règlement",
    payment_terms:"les modalités de paiement"
  };
  for(const [key,label] of Object.entries(essential))
    if(!data[key])throw Error("Renseigne "+label+" avant l'émission.");
  if(data.vat_mode==="non_precise")throw Error("Choisis le régime de TVA avant l'émission.");
  if(data.payment_due_date<invoiceLocalDate())
    throw Error("La date limite de paiement ne peut pas être dans le passé.");
  if(!data.lines.length||data.lines.some(l=>!l.label||l.price_cents<=0))
    throw Error("Renseigne les prestations et tous les prix avant l'émission.");
  if(data.client_type==="professionnel"&&!data.late_penalties)
    throw Error("Renseigne les pénalités de retard applicables au client professionnel.");
}
export function invoiceNumber(number){
  return Number.isSafeInteger(number)&&number>0 ? "FAC-"+String(number).padStart(6,"0") : null;
}
export function publicInvoice(row){
  const raw=JSON.parse(row.data_json);
  return {
    id:row.id,booking_id:row.booking_id||null,quote_id:row.quote_id||null,
    number:invoiceNumber(row.number),status:row.status,
    paid:!!row.paid,paid_at:row.paid_at||null,
    issued_at:row.issued_at||null,created_at:row.created_at,
    updated_at:row.updated_at,data:raw
  };
}
