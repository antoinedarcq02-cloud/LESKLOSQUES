// Nettoyage exceptionnel réservé au tout premier document de TEST, jamais transmis ni payé.
// Une sauvegarde d'audit reste dans D1 ; aucune vraie facture émise n'est concernée.
export async function ensureInvoiceTestAudit(DB) {
  await DB.prepare(`CREATE TABLE IF NOT EXISTS invoice_test_resets (
    invoice_id TEXT PRIMARY KEY,
    original_number INTEGER NOT NULL,
    original_data_json TEXT NOT NULL,
    original_issued_at TEXT,
    reset_at TEXT NOT NULL DEFAULT (datetime('now')),
    reset_by TEXT NOT NULL,
    reason TEXT NOT NULL
  )`).run();
}

// L'éligibilité est vérifiée de nouveau au moment de la suppression, dans la
// même transaction que les opérations sur la facture et la numérotation.
export const INITIAL_TEST_CONDITIONS = `
  i.status='emise'
  AND i.number=1
  AND i.paid=0
  AND i.paid_at IS NULL
  AND (SELECT COUNT(*) FROM official_invoices)=1
  AND (SELECT COUNT(*) FROM invoice_sequence)=1
  AND EXISTS (
    SELECT 1 FROM invoice_sequence s
    WHERE s.invoice_id=i.id AND s.number=1
  )
  AND (SELECT COUNT(*) FROM invoice_email_sends)=0
  AND (SELECT COUNT(*) FROM invoice_test_resets)=0
`;

export async function eligibleInitialTestId(DB) {
  await ensureInvoiceTestAudit(DB);
  const row=await DB.prepare(
    "SELECT i.id FROM official_invoices i WHERE "+INITIAL_TEST_CONDITIONS+" LIMIT 1"
  ).first();
  return row?.id || null;
}
