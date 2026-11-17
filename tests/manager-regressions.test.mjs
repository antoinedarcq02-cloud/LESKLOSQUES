import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Les devis et factures ouvrent leur aperçu dans le Manager',()=>{
  const viewer=read('admin/pdf-preview.js');
  const quote=read('admin/quote-builder.js');
  const invoice=read('admin/invoice-builder.js');
  const html=read('admin/index.html');
  assert.match(viewer,/MANAGER_PDF_SOURCES\s*=\s*\[/);
  assert.match(viewer,/managerPdfRetry\.addEventListener\('click'/);
  assert.match(viewer,/Retour aux factures/);
  assert.match(viewer,/Retour aux devis/);
  assert.match(quote,/await showManagerPdfPreview\(blob/);
  assert.match(invoice,/await showManagerPdfPreview\(blob/);
  assert.doesNotMatch(quote,/window\.open\('about:blank'/);
  assert.doesNotMatch(invoice,/window\.open\('about:blank'/);
  assert.match(html,/id="managerPdfRetry"/);
});

test('Les rappels de conservation excluent les dossiers liés et restent réservés au gestionnaire',()=>{
  const source=read('admin/reminders.js');
  const start=source.indexOf('function reminderTimestamp(');
  const end=source.indexOf('\nfunction renderManagerReminders(',start);
  assert.ok(start>=0&&end>start);
  const code=source.slice(start,end)+'\nreturn computeManagerReminders;';
  const now=new Date('2026-11-17T12:00:00Z');
  const old=(id,status='refuse')=>({
    id,source:'site',status,name:'Client',event_date:'2025-06-01',
    updated_at:'2025-01-01 12:00:00'
  });
  const bookings=[old('OLDER'),old('LINKED-QUOTE'),old('LINKED-INVOICE'),
    {...old('RECENT'),updated_at:'2026-10-01 12:00:00'},
    old('CONFIRMED','confirme')];
  const quotes=[{id:1,booking_id:'LINKED-QUOTE',status:'finalise',
    sent_at:'2025-01-01',data:{event_date:'2025-06-01'}}];
  const invoices=[{id:'I1',booking_id:'LINKED-INVOICE',status:'emise',
    paid:true,sent_at:'2025-01-01',data:{}}];
  const compute=role=>Function('state',code)({role})(bookings,quotes,invoices,now)
    .filter(r=>r.key.startsWith('retention:')).map(r=>r.id);
  assert.deepEqual(compute('admin'),['OLDER']);
  assert.deepEqual(compute('member'),[]);
});

test('L’archive exportée exclut les secrets et refuse un compte non gestionnaire',async()=>{
  const source=read('functions/api/admin/data-export.js')
    .replace(/^import .*?;\s*$/gm,'')
    .replace('export async function onRequestGet','async function onRequestGet');
  class MockResponse{
    constructor(body,{status=200,headers={}}={}){this.body=body;this.status=status;this.headers=headers}
    static json(body,opts){return new MockResponse(JSON.stringify(body),opts)}
  }
  const build=role=>Function('authorize','Response',source+'\nreturn onRequestGet;')(
    async()=>({user:{role}}),MockResponse
  );
  const data={
    bookings:[{id:'B1',name:'Client'}],
    official_invoices:[{id:'I1',number:1}],
    invoice_rib_attachment:[{content:'PRIVATE_RIB'}],
    admin_users:[{password_hash:'PRIVATE_HASH'}]
  };
  const DB={prepare(sql){return{
    bind(...args){this.args=args;return this},
    async all(){
      if(sql.includes('sqlite_master'))
        return {results:Object.keys(data).map(name=>({name}))};
      const table=Object.keys(data)
        .find(name=>sql.startsWith('SELECT * FROM '+name+' '));
      return {results:table?data[table].slice(this.args[1],this.args[1]+this.args[0]):[]};
    }
  }}};
  const context={env:{DB}};
  const rejected=await build('member')(context);
  assert.equal(rejected.status,403);
  const accepted=await build('admin')(context);
  assert.equal(accepted.status,200);
  const contents=JSON.parse(accepted.body);
  assert.equal(contents.tables.bookings.length,1);
  assert.equal(contents.tables.official_invoices.length,1);
  assert.ok(!('invoice_rib_attachment' in contents.tables));
  assert.ok(!('admin_users' in contents.tables));
  assert.equal(accepted.headers['Cache-Control'],'private, no-store');
  assert.match(accepted.headers['Content-Disposition'],/attachment/);
});

test('Une demande liée à une facture ou à un devis ne doit pas être supprimée',()=>{
  const source=read('functions/api/admin/bookings/[id].js');
  assert.match(source,/FROM official_quotes WHERE booking_id=\?/);
  assert.match(source,/FROM official_invoices WHERE booking_id=\?/);
  assert.match(source,/Conserve le dossier pour assurer la traçabilité comptable/);
});
