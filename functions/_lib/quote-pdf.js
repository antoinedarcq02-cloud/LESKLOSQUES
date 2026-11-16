// Modele de devis A4 inspire du document HAPPY LIVE 66 fourni par le groupe.
// Le meme format est utilise pour la piece jointe PDF Microsoft / Resend.
// Pas de reprise d'une signature, d'un tampon, ni de donnees clients de l'exemple.
function cp1252(value){
  const extra={"€":128,"’":146,"‘":145,"“":147,"”":148,"–":150,"—":151,"œ":156,"Œ":140,"…":133};
  let s="";
  for(const c of String(value??"")){
    const n=c.codePointAt(0);
    s+=String.fromCharCode(extra[c]??(n<=255?n:63));
  }
  return s;
}
function pdfLiteral(s){
  return cp1252(String(s??"").replace(/[\r\n]+/g," "))
    .replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");
}
function pdfBytes(s){
  const r=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)r[i]=s.charCodeAt(i)&255;
  return r;
}
function dateLabel(value){
  return /^\d{4}-\d\d-\d\d$/.test(value||"")
    ?value.slice(8)+"/"+value.slice(5,7)+"/"+value.slice(0,4)
    :(value||"A preciser");
}
function money(cents){
  return (cents/100).toLocaleString("fr-FR",{
    minimumFractionDigits:2,maximumFractionDigits:2
  }).replace(/[\u00a0\u202f]/g," ")+" €";
}
function qtyLabel(value){
  return value.toLocaleString("fr-FR",{
    minimumFractionDigits:2,maximumFractionDigits:2
  }).replace(/[\u00a0\u202f]/g," ");
}
function wrap(value,maxChars){
  const result=[];
  for(const paragraph of String(value??"").split(/\r?\n/)){
    if(!paragraph.trim()){result.push("");continue;}
    let line="";
    for(let word of paragraph.trim().split(/\s+/)){
      while(word.length>maxChars){
        if(line){result.push(line);line="";}
        result.push(word.slice(0,maxChars));
        word=word.slice(maxChars);
      }
      if(!word)continue;
      if(line&&line.length+word.length+1>maxChars){
        result.push(line);line=word;
      }else line+=(line?" ":"")+word;
    }
    if(line)result.push(line);
  }
  return result;
}
function numberValue(value){
  const n=Number(value);
  if(!Number.isFinite(n)||n<=0)return null;
  return n;
}
function amounts(data){
  const rows=[];
  let htSum=0,previousTax=0;
  const taxable=data.vat_mode!=="non_precise";
  const rate=taxable&&data.vat_mode!=="franchise"?Number(data.vat_mode):0;
  if(!Number.isFinite(rate)||rate<0||rate>100)throw Error("TVA invalide.");
  for(const row of data.lines){
    const qty=numberValue(row.qty),unit=Number(row.price_cents);
    if(qty===null||!Number.isSafeInteger(unit)||unit<0)
      throw Error("Montant du devis invalide.");
    const lineHT=Math.round(qty*unit);
    if(!Number.isSafeInteger(lineHT))throw Error("Montant du devis invalide.");
    htSum+=lineHT;
    if(!Number.isSafeInteger(htSum))throw Error("Montant du devis invalide.");
    const cumulativeTax=Math.round(htSum*rate/100);
    rows.push({
      label:String(row.label||"Prestation"),qty,unitHT:unit,ht:lineHT,
      unitDisplayed:taxable?Math.round(unit*(100+rate)/100):unit,
      amountDisplayed:taxable?lineHT+cumulativeTax-previousTax:lineHT
    });
    previousTax=cumulativeTax;
  }
  return{rows,ht:htSum,tax:previousTax,ttc:htSum+previousTax,taxable,rate};
}
function makePdf(objects){
  const parts=[],offsets=[0];let cursor=0;
  function add(s){const b=pdfBytes(s);parts.push(b);cursor+=b.length;}
  add("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  for(let i=1;i<objects.length;i++){
    offsets.push(cursor);add(i+" 0 obj\n"+objects[i]+"\nendobj\n");
  }
  const xref=cursor;
  add("xref\n0 "+objects.length+"\n0000000000 65535 f \n");
  for(let i=1;i<offsets.length;i++)
    add(String(offsets[i]).padStart(10,"0")+" 00000 n \n");
  add("trailer\n<< /Root 1 0 R /Size "+objects.length+" >>\nstartxref\n"+xref+"\n%%EOF\n");
  const result=new Uint8Array(cursor);let pos=0;
  for(const part of parts){result.set(part,pos);pos+=part.length;}
  return result;
}
export function createQuotePdf(quote){
  const q=quote?.data;
  if(!q||!Array.isArray(q.lines))throw Error("Devis non valide.");
  const totals=amounts(q);
  const pages=[];let ops=[];
  function stroke(x1,y1,x2,y2,color="0.73 0.73 0.73",width=.55){
    ops.push(color+" RG "+width+" w "+x1+" "+y1+" m "+x2+" "+y2+" l S");
  }
  function rect(x,y,w,h,color="0.75 0.75 0.75",width=.6){
    ops.push(color+" RG "+width+" w "+x+" "+y+" "+w+" "+h+" re S");
  }
  function fillRect(x,y,w,h,color="0.96 0.96 0.96"){
    ops.push(color+" rg "+x+" "+y+" "+w+" "+h+" re f");
  }
  function text(s,x,y,size=9,bold=false,color="0.19 0.19 0.19",italic=false){
    ops.push(color+" rg BT /"+(italic?"F3":bold?"F2":"F1")+" "+size+
      " Tf 1 0 0 1 "+x+" "+y+" Tm ("+pdfLiteral(s)+") Tj ET");
  }
  function para(s,x,y,width,size=8.5,spacing=12,bold=false,color){
    const rows=wrap(s,Math.max(8,Math.floor(width/(size*.6))));
    for(const row of rows){
      if(row)text(row,x,y,size,bold,color);
      y-=spacing;
    }
    return y;
  }
  function pageEnd(){if(ops.length){pages.push(ops.join("\n")+"\n");ops=[];}}
  function centered(s,left,right,y,size=8,bold=false,color){
    const approx=s.length*size*.52;
    text(s,Math.max(left+4,left+(right-left-approx)/2),y,size,bold,color);
  }
  // En-tete : quatre curseurs de console et nom de l'emetteur.
  const brand=/happy\s*live\s*66/i.test(q.issuer_name||"")?"Happy Live 66":"Les Klosques";
  function drawLogo(){
    const faderY=[770,760,775,750];
    for(let i=0;i<4;i++){
      const x=84+i*23;
      stroke(x,735,x,786,"0.52 0.52 0.52",1);
      fillRect(x-5,faderY[i]-4,10,8,"0.68 0.71 0.70");
      rect(x-5,faderY[i]-4,10,8,"0.44 0.46 0.45",.5);
    }
    text(brand,184,755,17,true,"0.42 0.42 0.42",true);
    text("DEVIS",475,720,14,false,"0.84 0.84 0.84");
  }
  function drawFirstHeader(){
    drawLogo();
    let y=679;
    y=para(q.issuer_name||"Structure emettrice",56,y,246,9,12,true);
    y=para(q.issuer_address||"",56,y-2,245,8,11);
    if(q.issuer_identifier)y=para("Identifiant : "+q.issuer_identifier,56,y-2,245,8,11);
    if(q.issuer_tax_number)y=para("N° TVA : "+q.issuer_tax_number,56,y,245,8,11);
    if(q.issuer_contact)y=para(q.issuer_contact,56,y,245,8,11);
    if(q.issuer_legal)y=para(q.issuer_legal,56,y,245,8,11);
    text("DATE : "+dateLabel(q.issue_date),355,665,8.5,true);
    text("N° DEVIS : "+String(quote.number||""),355,650,8.5,true);
    text("VALABLE JUSQU'AU : "+dateLabel(q.valid_until),355,635,8);
    text("A : "+String(q.client_name||"Client a preciser"),355,568,8.8,true);
    let cy=554;
    cy=para(q.client_address||"",355,cy,190,8.3,11);
    if(q.client_email)cy=para(q.client_email,355,cy-3,190,8.3,11);
    // Les coordonnees longues repoussent le tableau plutot que de le recouvrir.
    const eventY=Math.min(488,y-25,cy-30);
    text("PRESTATION : "+dateLabel(q.event_date)+(q.event_time?" a "+q.event_time:""),56,eventY,8.4,true);
    const afterPlace=para(q.event_location||"",56,eventY-14,480,8.2,10);
    return Math.min(444,afterPlace-22);
  }
  const breaks=[55,294,347,465,548];
  function tableHead(top){
    fillRect(breaks[0],top-25,breaks[4]-breaks[0],25);
    rect(breaks[0],top-25,breaks[4]-breaks[0],25);
    for(let j=1;j<breaks.length-1;j++)
      stroke(breaks[j],top,breaks[j],top-25);
    centered("DESCRIPTION",breaks[0],breaks[1],top-16,8,true);
    centered("QUANTITE",breaks[1],breaks[2],top-16,7.2,true);
    centered(totals.taxable?"PRIX UNITAIRE (TTC)":"PRIX UNITAIRE (HT)",
      breaks[2],breaks[3],top-16,7.3,true);
    centered(totals.taxable?"MONTANT (TTC)":"MONTANT (HT)",
      breaks[3],breaks[4],top-16,7.4,true);
    return top-25;
  }
  function continuation(){
    pageEnd();
    text(brand,55,782,12,true,"0.43 0.43 0.43");
    text("DEVIS "+String(quote.number||"")+" (suite)",350,782,9,true,"0.52 0.52 0.52");
    stroke(55,770,548,770);
    return tableHead(744);
  }
  const tableTop=drawFirstHeader();
  let y;
  if(tableTop<245){
    // L'en-tete legal complet occupe la premiere page : commencer le tableau
    // sur la suivante, sans masquer les informations du devis.
    pageEnd();
    text(brand,55,782,12,true,"0.43 0.43 0.43");
    text("DEVIS "+String(quote.number||"")+" (suite)",350,782,9,true);
    stroke(55,770,548,770);
    y=tableHead(744);
  }else y=tableHead(tableTop);
  for(const row of totals.rows){
    const labelLines=wrap(row.label,43);
    const height=Math.max(28,12+labelLines.length*11);
    if(y-height<167)y=continuation();
    rect(breaks[0],y-height,breaks[4]-breaks[0],height);
    for(let j=1;j<breaks.length-1;j++)
      stroke(breaks[j],y,breaks[j],y-height);
    let ly=y-14;
    for(const line of labelLines){if(line)text(line,breaks[0]+5,ly,8.2);ly-=11;}
    centered(qtyLabel(row.qty),breaks[1],breaks[2],y-16,8);
    centered(money(row.unitDisplayed),breaks[2],breaks[3],y-16,8);
    centered(money(row.amountDisplayed),breaks[3],breaks[4],y-16,8);
    y-=height;
  }
  if(y-73<156)y=continuation();
  function totalRow(label,value,emphasis=false){
    const height=23;
    const x=347;
    if(emphasis)fillRect(x,y-height,548-x,height,"0.95 0.95 0.95");
    rect(x,y-height,548-x,height);
    stroke(465,y,465,y-height);
    text(label,354,y-15,emphasis?9:8,emphasis);
    centered(value,465,548,y-15,emphasis?9:8,emphasis);
    y-=height;
  }
  totalRow("SOUS-TOTAL HT",money(totals.ht));
  if(totals.taxable){
    totalRow(q.vat_mode==="franchise"?"TVA NON APPLIC.":"TVA "+String(q.vat_mode)+" %",money(totals.tax));
    totalRow("TOTAL TTC",money(totals.ttc),true);
  }else{
    totalRow("TVA A PRECISER","-",false);
    totalRow("TOTAL TTC","A preciser",true);
  }
  // Mentions supplementaires : conserve les modalites et les conditions
  // legales saisies dans le Manager, sans copier de signature existante.
  let footerY=Math.min(213,y-27);
  const more=String(q.payment_terms||"")+"\n"+
    String(q.conditions||"")+"\n"+
    (q.vat_mode==="franchise"?"TVA non applicable, art. 293 B du CGI":"");
  const footRows=wrap(more,104);
  if(footerY-35-footRows.length*11<78){
    pageEnd();
    text(brand,55,780,12,true,"0.43 0.43 0.43");
    text("DEVIS "+String(quote.number||"")+" - mentions",345,780,9,true);
    stroke(55,770,548,770);
    footerY=705;
  }
  text("Ordre du reglement : "+String(q.issuer_name||"Structure emettrice"),56,footerY,8.7);
  footerY-=18;
  footerY=para("Modalites de paiement : "+String(q.payment_terms||"A preciser"),56,footerY,490,8.1,11);
  if(q.conditions)footerY=para("Conditions particulieres : "+q.conditions,56,footerY-6,490,8.1,11);
  if(q.vat_mode==="franchise")
    footerY=para("TVA non applicable, art. 293 B du CGI",56,footerY-5,490,8.1,11);
  footerY-=20;
  if(footerY<90){
    pageEnd();
    footerY=730;
  }
  text("Bon pour accord - date et signature du client :",56,footerY,8.3);
  stroke(56,footerY-55,265,footerY-55,"0.75 0.75 0.75");
  pageEnd();
  const objs=[null,"<< /Type /Catalog /Pages 2 0 R >>","",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>"];
  const kids=[];
  for(const commands of pages){
    const idx=objs.length;
    kids.push(idx+" 0 R");
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents "+(idx+1)+" 0 R >>");
    objs.push("<< /Length "+commands.length+" >>\nstream\n"+commands+"endstream");
  }
  objs[2]="<< /Type /Pages /Count "+pages.length+" /Kids ["+kids.join(" ")+"] >>";
  return makePdf(objs);
}
export function encodePdfBase64(pdf){
  let s="";
  for(let i=0;i<pdf.length;i+=8192)
    s+=String.fromCharCode(...pdf.subarray(i,i+8192));
  return btoa(s);
}
