import { monthBounds, getBusyDates } from "../_lib/google.js";
import { authorize } from "../_lib/admin-auth.js";

// L'agenda n'étant plus publié sur le site, ne pas rendre les journées
// occupées du calendrier privé consultables anonymement.
export async function onRequestGet(context) {
  const access=await authorize(context);
  if(access.error)return access.error;
  const {request,env}=context;
  try {
    const month = new URL(request.url).searchParams.get("month");
    const { start, end } = monthBounds(month);
    const busyDates = await getBusyDates(env, start, end);
    return Response.json({ busyDates });
  } catch (error) {
    return Response.json({ error: error.message || "Agenda indisponible." }, { status: 503 });
  }
}
