// Disponible uniquement après activation d'un expéditeur vérifié.
// Resend: RESEND_API_KEY + RESEND_FROM_EMAIL ; ou Cloudflare Email: EMAIL + QUOTE_FROM_EMAIL.
export function quoteMailReady(env){
  return Boolean((env.EMAIL && env.QUOTE_FROM_EMAIL) ||
    (env.RESEND_API_KEY && env.RESEND_FROM_EMAIL));
}
export async function ensureQuoteEmailLog(DB){
  await DB.prepare("CREATE TABLE IF NOT EXISTS quote_email_sends (id INTEGER PRIMARY KEY AUTOINCREMENT, quote_id INTEGER NOT NULL, recipient TEXT NOT NULL, provider TEXT NOT NULL, message_id TEXT, sent_by TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
}
