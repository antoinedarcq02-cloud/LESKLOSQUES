import { monthBounds, getBusyDates } from "../_lib/google.js";

export async function onRequestGet({ request, env }) {
  try {
    const month = new URL(request.url).searchParams.get("month");
    const { start, end } = monthBounds(month);
    const busyDates = await getBusyDates(env, start, end);
    return Response.json({ busyDates });
  } catch (error) {
    return Response.json({ error: error.message || "Agenda indisponible." }, { status: 503 });
  }
}
