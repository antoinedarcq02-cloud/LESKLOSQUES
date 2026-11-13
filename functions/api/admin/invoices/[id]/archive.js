import { authorize, respond } from "../../../../_lib/admin-auth.js";
import { ensureInvoiceTables, validInvoiceId } from "../../../../_lib/invoice-core.js";

// Un document émis reste en base avec le même numéro ; seul son affichage change.
export async function onRequestPost(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  const id = context.params.id;
  if (!validInvoiceId(id)) return respond({ error:"Identifiant de facture invalide." }, 400);
  let payload;
  try {
    const raw = await context.request.text();
    if (raw.length > 1000) return respond({ error:"Confirmation trop longue." }, 413);
    payload = JSON.parse(raw);
  } catch { return respond({ error:"Confirmation invalide." }, 400); }
  if (payload?.action !== "archive" && payload?.action !== "restore")
    return respond({ error:"Action d'archivage inconnue." }, 400);
  try {
    const DB = context.env.DB;
    await ensureInvoiceTables(DB);
    const invoice = await DB.prepare("SELECT status FROM official_invoices WHERE id=?").bind(id).first();
    if (!invoice) return respond({ error:"Facture introuvable." }, 404);
    if (invoice.status !== "emise")
      return respond({ error:"Les brouillons peuvent être supprimés directement ; seules les factures émises peuvent être archivées." }, 409);
    if (payload.action === "archive") {
      await DB.prepare(`INSERT INTO invoice_archives (invoice_id,archived,archived_at,archived_by,changed_by)
        VALUES (?,1,datetime('now'),?,?)
        ON CONFLICT(invoice_id) DO UPDATE SET archived=1,archived_at=datetime('now'),
        archived_by=excluded.archived_by,changed_at=datetime('now'),changed_by=excluded.changed_by`)
        .bind(id,user.email,user.email).run();
    } else {
      await DB.prepare(`INSERT INTO invoice_archives (invoice_id,archived,archived_by,changed_by)
        VALUES (?,0,?,?)
        ON CONFLICT(invoice_id) DO UPDATE SET archived=0,changed_at=datetime('now'),
        changed_by=excluded.changed_by`)
        .bind(id,user.email,user.email).run();
    }
    return respond({ ok:true, archived:payload.action === "archive" });
  } catch (error) {
    console.warn("Erreur archivage facture",error?.message);
    return respond({ error:"Impossible de modifier l'archivage de cette facture." }, 503);
  }
}
