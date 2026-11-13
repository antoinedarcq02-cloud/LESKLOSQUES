// PDF A4 sans bibliothèque externe, pour l'envoi du devis finalisé.
function cp1252(value){
  const extra={"€":128,"’":146,"‘":145,"“":147,"”":148,"–":150,"—":151,"œ":156,"Œ":140,"…":133};
  let s="";
  for(const c of String(value??"")){const n=c.codePointAt(0);s+=String.fromCharCode(extra[c]??(n<=255?n:63));}
  return s;
}
function pdfLiteral(s){
  return cp1252(String(s??"").replace(/[\r\n]+/g," "))
    .replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}
function pdfBytes(s){const r=new Uint8Array(s.length);for(let i=0;i<s.length;i++)r[i]=s.charCodeAt(i)&255;return r;}
function pdfWrap(s,max){
  const out=[];for(const para of String(s??"").split(/\r?\n/)){
    let line="";for(let word of para.trim().split(/\s+/).filter(Boolean)){
      while(word.length>max){if(line){out.push(line);line="";}out.push(word.slice(0,max));word=word.slice(max);}
      if(line&&line.length+1+word.length>max){out.push(line);line=word;}else line+=(line?" ":"")+word;
    }
    if(line)out.push(line);
  }return out;
}
function dateLabel(value){return /^\d{4}-\d\d-\d\d$/.test(value||"")?value.slice(8)+"/"+value.slice(5,7)+"/"+value.slice(0,4):(value||"À préciser");}
function money(v){return (v/100).toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})+" €";}
export function createQuotePdf(quote){
  const q=quote.data;if(!q||!Array.isArray(q.lines))throw new Error("Devis non valide.");
  const sheets=[];let commands=[],y=795;
  function nextPage(){if(commands.length)sheets.push(commands.join("\n")+"\n");commands=[];y=795;}
  function fit(height){if(y-height<55)nextPage();}
  function write(s,size=10,bold=false,color="0 0 0",x=42){
    fit(size+8);commands.push(color+" rg BT /"+(bold?"F2":"F1")+" "+size+
      " Tf 1 0 0 1 "+x+" "+y+" Tm ("+pdfLiteral(s)+") Tj ET");y-=size+6;
  }
  function lines(s,size=10,bold=false,max=88,x=42){for(const row of pdfWrap(s,max))write(row,size,bold,"0 0 0",x);}
  function section(s){fit(36);y-=10;write(s,12,true,"0.62 0.1 0.2");y-=4;}
  function field(name,val){lines(name+" : "+(val||"À préciser"),10,false,90,46);}
  write("LES KLOSQUES  -  DEVIS",24,true,"0.65 0.09 0.19");
  write("N° "+quote.number,12,true);
  write("Date : "+dateLabel(q.issue_date)+"   Valable jusqu'au : "+dateLabel(q.valid_until),10);
  section("PRESTATAIRE / ÉMETTEUR");
  lines(q.issuer_name||"Structure à préciser",11,true,75,46);
  lines(q.issuer_address,10,false,90,46);
  field("Identifiant officiel",q.issuer_identifier);
  if(q.issuer_tax_number)field("N° TVA",q.issuer_tax_number);
  if(q.issuer_contact)lines(q.issuer_contact,10,false,90,46);
  if(q.issuer_legal)lines(q.issuer_legal,10,false,90,46);
  section("CLIENT / ORGANISATEUR");
  lines(q.client_name||"Client à préciser",11,true,75,46);
  lines(q.client_address,10,false,90,46);
  if(q.client_email)lines(q.client_email,10,false,90,46);
  section("ÉVÉNEMENT");
  field("Date",dateLabel(q.event_date)+(q.event_time?" à "+q.event_time:""));
  field("Lieu",q.event_location);
  if(q.description)lines(q.description,10,false,90,46);
  section("PRESTATIONS");
  let sum=0;for(const row of q.lines){
    const qty=Number(row.qty),unit=Number(row.price_cents);
    if(!Number.isFinite(qty)||qty<=0||!Number.isSafeInteger(unit)||unit<0)throw Error("Montant invalide.");
    const ht=Math.round(qty*unit);sum+=ht;fit(50);
    lines(row.label||"Prestation",10,true,90,46);
    write("Quantité : "+qty+"   Prix unitaire HT : "+money(unit)+"   Total HT : "+money(ht),9,false,"0.2 0.2 0.2",48);y-=5;
  }
  section("TOTAUX");
  field("Total HT",money(sum));
  if(q.vat_mode==="non_precise"){field("TVA","À préciser");field("Total TTC","À préciser");}
  else{
    const rate=q.vat_mode==="franchise"?0:Number(q.vat_mode);
    const tax=Math.round(sum*rate/100);
    field(q.vat_mode==="franchise"?"TVA non applicable (art. 293 B CGI)":"TVA "+q.vat_mode+" %",money(tax));
    write("TOTAL TTC : "+money(sum+tax),13,true,"0.65 0.09 0.19",46);
  }
  section("MODALITÉS DE PAIEMENT");
  lines(q.payment_terms||"À préciser",10,false,90,46);
  if(q.conditions){section("CONDITIONS PARTICULIÈRES");lines(q.conditions,10,false,90,46);}
  section("ACCORD CLIENT");
  lines('Signature précédée de la mention "Bon pour accord"',10,false,90,46);
  fit(58);y-=37;write("Date : ____________    Signature : __________________________",10,false,"0 0 0",46);
  nextPage();
  const objs=[null,"<< /Type /Catalog /Pages 2 0 R >>","",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  const kids=[];
  for(const content of sheets){
    const p=objs.length,k=p+1;kids.push(p+" 0 R");
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents "+k+" 0 R >>");
    objs.push("<< /Length "+content.length+" >>\nstream\n"+content+"endstream");
  }
  objs[2]="<< /Type /Pages /Count "+sheets.length+" /Kids ["+kids.join(" ")+"] >>";
  const parts=[],offsets=[0];let cursor=0;
  function append(s){const b=pdfBytes(s);parts.push(b);cursor+=b.length;}
  append("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for(let i=1;i<objs.length;i++){offsets.push(cursor);append(i+" 0 obj\n"+objs[i]+"\nendobj\n");}
  const xref=cursor;append("xref\n0 "+objs.length+"\n0000000000 65535 f \n");
  for(let i=1;i<offsets.length;i++)append(String(offsets[i]).padStart(10,"0")+" 00000 n \n");
  append("trailer\n<< /Root 1 0 R /Size "+objs.length+" >>\nstartxref\n"+xref+"\n%%EOF\n");
  const result=new Uint8Array(cursor);let pos=0;for(const part of parts){result.set(part,pos);pos+=part.length;}
  return result;
}
export function encodePdfBase64(pdf){
  let s="";for(let i=0;i<pdf.length;i+=8192)s+=String.fromCharCode(...pdf.subarray(i,i+8192));
  return btoa(s);
}
