import { HAPPY_LIVE_LOGO_JPEG_BASE64 } from "./happy-live-logo.js";
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
function amounts(data,invoiceTtc=false){
  const rows=[];
  let htSum=0,previousTax=0;
  const direct=data.vat_mode==="ttc_sans_ventilation";
  const taxable=data.vat_mode!=="non_precise";
  const rate=taxable&&!direct&&data.vat_mode!=="franchise"?Number(data.vat_mode):0;
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
  if(invoiceTtc){
    // Pour les nouvelles factures, les prix saisis sont déjà TTC. On calcule
    // la ventilation HT/TVA depuis le montant final, sans ajouter de taxe
    // une deuxième fois. Les anciennes factures restent traitées en HT.
    const finalTTC=htSum;
    const netHT=taxable?Math.round(finalTTC/(1+rate/100)):finalTTC;
    for(const row of rows){
      row.unitDisplayed=row.unitHT;
      row.amountDisplayed=row.ht;
    }
    return{rows,ht:netHT,tax:finalTTC-netHT,ttc:finalTTC,taxable,rate,direct:false};
  }
  return{rows,ht:htSum,tax:previousTax,ttc:htSum+previousTax,taxable,rate,direct};
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
export function createQuotePdf(quote,options={}){
  const q=quote?.data;
  const invoice=options.type==="invoice";
  if(!q||!Array.isArray(q.lines))throw Error(invoice?"Facture non valide.":"Devis non valide.");
  const totals=amounts(q,invoice&&q.price_mode==="ttc");
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
  // Largeurs de Helvetica (unités pour 1000) : éviter les libellés de totaux
  // qui débordaient sur les cellules grises et centrer les intitulés.
  const caps={A:722,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,
    J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,
    T:611,U:722,V:667,W:944,X:667,Y:667,Z:611};
  function textWidth(value,size,bold=false){
    let units=0;
    for(const char of String(value)){
      if(caps[char])units+=caps[char];
      else if(/[0-9]/.test(char))units+=556;
      else if(char===" ")units+=278;
      else if(char==="-")units+=333;
      else if(char===",")units+=278;
      else if(char===".")units+=278;
      else if(char==="€")units+=556;
      else if(char===":")units+=278;
      else units+=bold?565:520;
    }
    return units*size/1000;
  }
  function centered(s,left,right,y,size=8,bold=false,color){
    const measured=textWidth(s,size,bold);
    text(s,Math.max(left+3,left+(right-left-measured)/2),y,size,bold,color);
  }
  // Présentation A4 inspirée des devis et factures HAPPY LIVE 66 transmis
  // par le groupe : logo coloré, coordonnées en deux colonnes, tableau bleu.
  // Le contenu client et les références proviennent toujours du document.
  const documentLabel=invoice?"FACTURE":"DEVIS";
  const isHappy=/happy\s*live\s*66/i.test(q.issuer_name||"");
  const brand=isHappy?"Happy Live 66":"Les Klosques";
  function drawLogo(){
    const offset=invoice?-15:0;
    if(isHappy){
      // Le logo réel provient du document de référence fourni par le groupe.
      // Il est intégré dans chaque PDF : ni image distante, ni dépendance réseau.
      // Recentré sur les mêmes coordonnées visuelles que le logo de référence.
      ops.push("q 225 0 0 61 69 "+(invoice?692:705)+" cm /HL66 Do Q");
    }else{
      // Repli neutre si la structure émettrice n'est pas Happy Live 66.
      const base=[715,704,712,691];
      for(let i=0;i<4;i++){
        const x=77+i*30;
        const knob=base[i]+offset;
        stroke(x,683+offset,x,746+offset,"0.09 0.51 0.72",1.25);
        stroke(x-1.9,746+offset,x+1.9,746+offset,"0.09 0.51 0.72",.55);
        fillRect(x-6,knob-4.5,12,9,"0.17 0.57 0.79");
        rect(x-6,knob-4.5,12,9,"0.09 0.39 0.61",.7);
      }
      text("Les Klosques",186,711+offset,16.7,true,"0.48 0.08 0.30",true);
    }
    text(documentLabel,invoice?469:481,invoice?663:681,15,true,"0.82 0.88 0.90");
    if(invoice&&quote.status!=="emise")
      text("BROUILLON - NON EMIS",43,657,9,true,"0.67 0.12 0.16");
  }
  function drawFirstHeader(){
    drawLogo();
    let y=invoice?628:649;
    const strapline=isHappy
      ?(invoice?"HAPPY LIVE 66 - CONCERTS - ANIMATIONS":
        "Association HAPPY LIVE 66 - CONCERTS - ANIMATIONS")
      :"LES KLOSQUES - CONCERTS - ANIMATIONS";
    text(strapline,43,y,invoice?8.4:7.45,true,"0.14 0.14 0.14",true);
    y-=18;
    // Nom complet affiché selon les documents de référence, sans modifier
    // le nom légal stocké dans les dossiers.
    const issuerName= /^Association\s+Happy\s+Live\s+66(?:\s*-\s*Groupe\s+LES\s+KLOSQUES)?$/i
      .test(String(q.issuer_name||"").trim())
      ?"Association HAPPY LIVE 66 - Groupe LES KLOSQUES"
      :(q.issuer_name||"Structure émettrice");
    y=para(issuerName,43,y,290,8.35,10.5);
    // Si l'adresse du profil est sur une seule ligne, séparer rue et CP/ville.
    const address=String(q.issuer_address||"").trim();
    const splitAddress=!address.includes("\n")&&address.match(/^(.+?)\s+(\d{5}\s+.+)$/);
    y=para(splitAddress?(splitAddress[1]+"\n"+splitAddress[2]):address,43,y-1,281,8.1,10.5);
    if(q.issuer_identifier){
      const id=String(q.issuer_identifier).trim();
      const digits=id.replace(/\s/g,"");
      const siren=/^\d{14}$/.test(digits);
      const normalized=siren?digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{5})$/,"$1 $2 $3 $4"):id;
      y=para((siren?"SIRET":"Identifiant")+" : "+normalized,43,y-3,280,8.1,11);
    }
    if(q.issuer_tax_number)y=para("N° TVA : "+q.issuer_tax_number,43,y-1,280,8.1,11);
    if(q.issuer_legal)y=para(q.issuer_legal,43,y-1,280,8.1,11);
    // Les e-mails personnels/de contact restent dans Manager et dans les
    // messages d'envoi, pas dans la zone d'adresse de cette maquette.

    const dateY=invoice?609:632;
    text("DATE : "+dateLabel(q.issue_date),377,dateY,8.3,true);
    text("N° "+documentLabel+" : "+String(quote.number||"NON ATTRIBUE"),377,dateY-11,8.3,true);

    // Le client est placé à droite, comme dans les exemples.
    let cy=invoice?543:548;
    cy=para((invoice?"À : ":"")+String(q.client_name||"Client à préciser"),370,cy,183,8.5,11,true);
    cy=para(q.client_address||"",370,cy-2,183,8.2,11,true);
    if(invoice&&q.client_identifier)
      cy=para("SIREN / SIRET : "+q.client_identifier,370,cy-2,183,8.0,10);

    // Les blocs longs repoussent le tableau et évitent les chevauchements.
    return Math.min(invoice?466.5:476.2,y-37,cy-30);
  }
  // La première colonne large conserve la description et le lieu du concert.
  const breaks=invoice?[43,319,371,470,554]:[43,323,368,483,555];
  const headerHeight=invoice?16.5:14.2;
  function tableHead(top){
    fillRect(breaks[0],top-headerHeight,breaks[4]-breaks[0],headerHeight,"0.847 0.894 0.910");
    rect(breaks[0],top-headerHeight,breaks[4]-breaks[0],headerHeight,"0 0 0",.55);
    for(let j=1;j<breaks.length-1;j++)
      stroke(breaks[j],top,breaks[j],top-headerHeight,"0 0 0",.55);
    const textY=top-(invoice?11.8:10.7);
    centered("DESCRIPTION",breaks[0],breaks[1],textY,invoice?8:7.8,true,"0.10 0.10 0.10");
    centered("QUANTITE",breaks[1],breaks[2],textY,invoice?7.2:6.9,true,"0.10 0.10 0.10");
    centered(totals.taxable?"PRIX UNITAIRE (TTC)":"PRIX UNITAIRE (HT)",
      breaks[2],breaks[3],textY,invoice?7.1:7,true,"0.10 0.10 0.10");
    centered(totals.taxable?"MONTANT (TTC)":"MONTANT (HT)",
      breaks[3],breaks[4],textY,invoice?7.1:7,true,"0.10 0.10 0.10");
    return top-headerHeight;
  }
  function right(s,rightEdge,y,size=8,bold=false,color){
    text(s,rightEdge-textWidth(s,size,bold),y,size,bold,color);
  }
  function continuation(){
    pageEnd();
    text(brand,55,782,12,true,"0.43 0.43 0.43");
    text(documentLabel+" "+String(quote.number||"")+" (suite)",350,782,9,true,"0.52 0.52 0.52");
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
    text(documentLabel+" "+String(quote.number||"")+" (suite)",350,782,9,true);
    stroke(55,770,548,770);
    y=tableHead(744);
  }else y=tableHead(tableTop);
  let firstRow=true;
  for(const row of totals.rows){
    let description=row.label;
    if(!invoice&&firstRow&&q.event_date&&/^\d{4}-\d\d-\d\d$/.test(q.event_date)&&
       !description.includes(dateLabel(q.event_date)))
      description+=" le "+dateLabel(q.event_date);
    const labelLines=wrap(description,62);
    if(!invoice&&firstRow&&q.event_location&&
       !description.toLocaleLowerCase("fr-FR").includes(String(q.event_location).toLocaleLowerCase("fr-FR")))
      labelLines.push(...wrap("Lieu : "+q.event_location,62));
    const height=Math.max(invoice?49.9:42.6,12+labelLines.length*11);
    if(y-height<172)y=continuation();
    rect(breaks[0],y-height,breaks[4]-breaks[0],height,"0 0 0",.55);
    for(let j=1;j<breaks.length-1;j++)
      stroke(breaks[j],y,breaks[j],y-height,"0 0 0",.55);
    let ly=y-(invoice?12:11);
    for(const line of labelLines){if(line)text(line,breaks[0]+1,ly,7.6);ly-=11;}
    centered(qtyLabel(row.qty),breaks[1],breaks[2],y-13,7.8);
    right(money(row.unitDisplayed),breaks[3]-5,y-13,7.8);
    right(money(row.amountDisplayed),breaks[4]-1,y-13,7.8);
    y-=height;
    firstRow=false;
  }
  if(y-86<153)y=continuation();
  function totalRow(label,value,emphasis=false){
    const height=invoice?16.6:14.2;
    fillRect(breaks[3],y-height,breaks[4]-breaks[3],height,"0.918 0.918 0.918");
    rect(breaks[3],y-height,breaks[4]-breaks[3],height,"0 0 0",.5);
    const baseline=y-(invoice?12:10);
    right(label,breaks[3]-1,baseline,emphasis?8:7.7,emphasis);
    right(value,breaks[4]-1,baseline,emphasis?8.2:7.8,emphasis);
    y-=height;
  }
  // Prix TTC sans ventilation ou franchise : le modèle d'origine affiche
  // seulement le sous-total et le total. La mention d'exonération reste en bas.
  const simplifiedTotals=totals.direct||q.vat_mode==="franchise";
  totalRow(simplifiedTotals?"SOUS-TOTAL":"SOUS-TOTAL HT",
    money(simplifiedTotals?totals.ttc:totals.ht));
  y-=invoice?16.6:14.2; // Espacement réel entre sous-total et total dans les modèles.
  if(simplifiedTotals){
    totalRow("TOTAL TTC",money(totals.ttc),true);
  }else if(totals.taxable){
    totalRow(q.vat_mode==="franchise"?"TVA NON APPLIC.":"TVA "+String(q.vat_mode)+" %",money(totals.tax));
    totalRow("TOTAL TTC",money(totals.ttc),true);
  }else{
    totalRow("TVA A PRECISER","-",false);
    totalRow("TOTAL TTC","A preciser",true);
  }
  // Mentions supplementaires : conserve les modalites et les conditions
  // legales saisies dans le Manager, sans copier de signature existante.
  let footerY=Math.min(invoice?309:321,y-35);
  const more=(q.payment_terms?String(q.payment_terms)+"\n":"")+
    String(q.conditions||"")+"\n"+
    (q.vat_mode==="franchise"?"TVA non applicable, art. 293 B du CGI":"");
  const footRows=wrap(more,104);
  if(footerY-35-footRows.length*11<78){
    pageEnd();
    text(brand,55,780,12,true,"0.43 0.43 0.43");
    text(documentLabel+" "+String(quote.number||"")+" - mentions",345,780,9,true);
    stroke(55,770,548,770);
    footerY=705;
  }
  // Les anciens devis conservent leurs mentions ; les nouveaux ne montrent
  // plus de rubrique de paiement ni de texte "A preciser" artificiel.
  if(!invoice){
    const payee=String(q.issuer_name||"Structure émettrice")
      .replace(/\s*-\s*Groupe\s+LES\s+KLOSQUES.*$/i,"").trim();
    const payeeLabel=/^Association\s+Happy\s+Live\s+66$/i.test(payee)
      ?"Association HAPPY LIVE 66":payee;
    text("Ordre du règlement : "+payeeLabel,43,footerY,8.4);
    footerY-=18;
    if(q.valid_until)footerY=para("Devis valable jusqu'au : "+dateLabel(q.valid_until),43,footerY,495,8.1,11);
  }
  if(q.payment_terms)
    footerY=para("Modalites de paiement : "+String(q.payment_terms),43,footerY-3,500,8.1,11);
  if(q.conditions)footerY=para("Conditions particulières : "+q.conditions,56,footerY-6,490,8.1,11);
  if(q.vat_mode==="franchise")
    footerY=para("TVA non applicable, art. 293 B du CGI",56,footerY-5,490,8.1,11);
  if(invoice){
    // Sur les factures, la description reste telle que saisie. Si la date
    // de prestation diffère de celle d'émission, elle reste précisée en bas.
    if(q.event_date&&q.event_date!==q.issue_date)
      footerY=para("Date de prestation : "+dateLabel(q.event_date)+
        (q.event_location?" - "+q.event_location:""),56,footerY-6,490,8.1,11);
    footerY=para("Date limite de paiement : "+dateLabel(q.payment_due_date),56,footerY-6,490,8.1,11);
    if(q.client_type==="professionnel"){
      footerY=para("Pénalités de retard : "+String(q.late_penalties||"À préciser"),56,footerY-7,490,8.1,11);
      footerY=para("Indemnité forfaitaire de recouvrement : 40 euros (si applicable).",
        56,footerY-4,490,8.1,11);
    }
  }
  footerY-=20;
  if(footerY<90){
    pageEnd();
    footerY=730;
  }
  // Aucun cadre de signature automatique : le modèle remis n'en comporte pas.
  pageEnd();
  const objs=[null,"<< /Type /Catalog /Pages 2 0 R >>","",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>"];
  let logoObjectId=null;
  if(isHappy){
    const binary=atob(HAPPY_LIVE_LOGO_JPEG_BASE64);
    logoObjectId=objs.length;
    objs.push("<< /Type /XObject /Subtype /Image /Width 311 /Height 100"+
      " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+
      binary.length+" >>\nstream\n"+binary+"\nendstream");
  }
  const kids=[];
  for(const commands of pages){
    const idx=objs.length;
    kids.push(idx+" 0 R");
    const xObject=logoObjectId===null?"":" /XObject << /HL66 "+logoObjectId+" 0 R >>";
    objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>"+xObject+" >> /Contents "+(idx+1)+" 0 R >>");
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
