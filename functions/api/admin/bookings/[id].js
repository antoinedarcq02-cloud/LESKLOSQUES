import { authorize, respond, cleanText, validDate, statuses } from "../../../_lib/admin-auth.js";
import { syncRequestToGoogle } from "../../../_lib/booking-google-sync.js";

const EDITABLE = {
  name: 150, email: 254, phone: 50, event_type: 100, event_date: 10,
  location: 200, package: 200, message: 2500, notes: 3000
};

export async function onRequestGet(context) {
  const user = await authorize(context);
  if (user.error) return user.error;
  const id = context.params.id;
  if (!/^[\da-f-]{36}$/.test(id || "")) return respond({ error: "Identifiant invalide." }, 400);
  const booking = await context.env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(id).first();
  return booking ? respond({ booking }) : respond({ error: "Dossier introuvable." }, 404);
}

export async function onRequestPatch(context) {
  const user = await authorize(context, true);
  if (user.error) return user.error;
  const id = context.params.id;
  if (!/^[\da-f-]{36}$/.test(id || "")) return respond({ error: "Identifiant invalide." }, 400);
  try {
    const raw = await context.request.text();
    if (raw.length > 16000) return respond({ error: "Dossier trop long." }, 413);
    const data = JSON.parse(raw);
    const updates = {};
    for (const [key, max] of Object.entries(EDITABLE)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) updates[key] = cleanText(data[key], max);
    }
    if ("status" in data) {
      if (!statuses.includes(data.status)) return respond({ error: "Statut invalide." }, 400);
      updates.status = data.status;
    }
    if ("quote_amount_cents" in data) {
      const amount = data.quote_amount_cents;
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000))
        return respond({ error: "Montant invalide." }, 400);
      updates.quote_amount_cents = amount;
    }
    if ("event_date" in updates && !validDate(updates.event_date))
      return respond({ error: "Date invalide." }, 400);
    if ("location" in updates && !updates.location) return respond({ error: "Le lieu est obligatoire." }, 400);
    if ("name" in updates && !updates.name) return respond({ error: "Un nom est obligatoire." }, 400);
    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email))
      return respond({ error: "E-mail invalide." }, 400);
    if (Object.keys(updates).length === 0) return respond({ error: "Aucune modification fournie." }, 400);
    const fields = Object.keys(updates);
    const values = fields.map(key => updates[key]);
    const statement = "UPDATE bookings SET " + fields.map(key => key + "=?").join(", ") +
      ", updated_at=datetime('now'), updated_by=? WHERE id=?";
    const result = await context.env.DB.prepare(statement).bind(...values, user.email, id).run();
    if (!result.meta?.changes) return respond({ error: "Dossier introuvable." }, 404);
    const booking = await context.env.DB.prepare("SELECT * FROM bookings WHERE id=?").bind(id).first();
    let googleWarning="";
    if(booking?.source==="site"){
      // Attendre Google pour que le changement de statut soit reflété avant
      // la confirmation dans Manager, notamment pour un refus / retour en attente.
      try{
        await syncRequestToGoogle(context.env,booking);
      }catch(error){
        console.warn("Suivi Google de la demande indisponible",error?.message||error);
        googleWarning="Le dossier est enregistré, mais Google Agenda n'a pas pu être actualisé. Vérifie la connexion puis réenregistre le dossier.";
      }
    }
    return respond({ booking,...(googleWarning?{google_warning:googleWarning}:{}) });
  } catch (error) {
    console.warn("Erreur modification concert", error?.message);
    return respond({ error: "Enregistrement impossible." }, 503);
  }
}


// Supprimer uniquement une demande issue du formulaire public.
// Chaque suppression exige une session de musicien et une requête de même origine.
export async function onRequestDelete(context) {
  const access = await authorize(context, true);
  if (access.error) return access.error;
  const id = context.params.id;
  if (!/^[\da-f-]{36}$/.test(id || ""))
    return respond({ error: "Identifiant invalide." }, 400);
  try {
    // Ne pas perdre l'association Google : la fiche est encore en D1 pendant
    // la suppression distante. Une panne Google conserve donc la demande et
    // permet à l'utilisateur de réessayer sans étape supplémentaire.
    const booking=await context.env.DB.prepare(
      "SELECT id,source,status,event_date,location FROM bookings WHERE id=? AND source='site'"
    ).bind(id).first();
    if(!booking)
      return respond({error:"Demande introuvable ou suppression impossible pour une fiche concert manuelle."},404);
    let google;
    try{
      google=await syncRequestToGoogle(context.env,booking,{remove:true});
    }catch(error){
      console.warn("Suppression Google de la demande impossible",error?.message||error);
      return respond({
        error:"La demande a été conservée : impossible de supprimer son événement Google. Vérifie la connexion Google puis réessaie."
      },503);
    }
    // N'effacer la fiche qu'après la suppression (ou l'absence vérifiée)
    // de son événement Google. Le bouton n'a plus besoin d'être cliqué deux fois.
    const result=await context.env.DB.prepare(
      "DELETE FROM bookings WHERE id=? AND source='site'"
    ).bind(id).run();
    if(!result.meta?.changes)
      return respond({error:"La fiche a changé pendant la suppression. Actualise les demandes puis réessaie."},409);
    await context.env.DB.prepare("DELETE FROM google_event_optouts WHERE booking_id=?").bind(id).run();
    return respond({
      ok:true,deleted:true,
      google_status:google?.removed?"removed":google?.google_disconnected?"not_connected":"unchanged"
    });
  } catch (error) {
    console.warn("Erreur suppression demande client", error?.message || error);
    return respond({ error: "Impossible de supprimer cette demande pour le moment." }, 503);
  }
}
