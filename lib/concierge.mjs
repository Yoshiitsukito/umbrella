import { loadEnv } from "./env.mjs";
import { attachRoutes, flightSearchLink, geocode, resolveAirports, searchFlights, searchFood } from "./geo.mjs";
import { addDays, localParts, parseAsk } from "./places.mjs";
import { todaySchedule } from "./wellness.mjs";
import { chat, configuredProviders, providerLabel } from "./ai.mjs";

loadEnv();

function durationPhrase(seconds) {
  if (seconds == null) return null;
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 90) return `${mins} мин`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours} ц ${rest} мин` : `${hours} ц`;
}

function trafficWord(level) {
  if (level === "light") return "сул";
  if (level === "medium") return "дунд";
  if (level === "heavy") return "хүнд";
  return null;
}

function formatLeg(leg) {
  if (!leg) return null;
  if (leg.unavailable) return "энэ зайд тохирохгүй";
  const base = durationPhrase(leg.durationSec);
  if (base == null) return "зам олдсонгүй";
  const traffic = trafficWord(leg.traffic);
  if (leg.durationTrafficSec) {
    return `${durationPhrase(leg.durationTrafficSec)}, түгжрэл ${traffic} (${leg.source})`;
  }
  return `${base} (${leg.source})`;
}

export function formatPlaces(result) {
  if (!result.places.length) {
    return `${result.radiusM} м дотор хоолны газар олдсонгүй. Эх сурвалж: ${result.source}.`;
  }
  const lines = result.places.map((place, index) => {
    const distance = place.distanceM < 1000 ? `${place.distanceM} м` : `${(place.distanceM / 1000).toFixed(1)} км`;
    const open = place.openNow == null ? "" : place.openNow ? ", одоо нээлттэй" : ", одоо хаалттай";
    const rating = place.rating ? `, үнэлгээ ${place.rating}` : "";
    return `${index + 1}. ${place.name} (${place.category}) — ${distance} — машин ${formatLeg(place.drive) || "олдсонгүй"} — явган ${formatLeg(place.walk) || "олдсонгүй"}${open}${rating}`;
  });
  return `${result.label} орчим ${result.radiusM} м дотор ${result.places.length} газар. Эх сурвалж: ${result.source}.\n${lines.join("\n")}`;
}

export async function findFood(origin, radiusM, query, label) {
  const found = await searchFood(origin.lat, origin.lng, radiusM, query);
  const places = await attachRoutes(origin, found.places, { walk: true });
  return { ...found, places, radiusM, label: label || "таны байршил" };
}

export async function planTrip(origin, parsed) {
  const named = parsed.destination.place;
  const query = parsed.destination.query;
  let point = null;
  if (query) {
    try {
      point = await geocode(query);
    } catch {
      point = null;
    }
  }
  const airports = resolveAirports(origin, point, named?.code && !named.generic ? named.code : named?.generic ? named.code : null);
  const target = point || (airports.destination ? { lat: airports.destination.lat, lng: airports.destination.lng, label: airports.destination.city } : null);
  let drive = null;
  if (target) {
    const [routed] = await attachRoutes(origin, [{ ...target, name: query || airports.destination?.city || "очих цэг", category: "очих цэг" }], {
      walk: target && haversineSafe(origin, target) < 15000,
    });
    drive = routed || null;
  }
  const distanceM = target ? Math.round(haversineSafe(origin, target)) : null;
  const needsFlight = Boolean(airports.destination && airports.origin && airports.origin.code !== airports.destination.code && (distanceM == null || distanceM > 400000));
  let flights = null;
  if (needsFlight) {
    try {
      flights = await searchFlights(airports.origin.code, airports.destination.code, parsed.date);
    } catch (error) {
      flights = {
        configured: true,
        origin: airports.origin.code,
        destination: airports.destination.code,
        date: parsed.date,
        offers: [],
        source: "Amadeus",
        error: error.message,
      };
    }
    flights.link = flightSearchLink(airports.origin.code, airports.destination.code, parsed.date);
  }
  return {
    query,
    generic: Boolean(named?.generic),
    point,
    distanceM,
    drive,
    airports,
    needsFlight,
    flights,
  };
}

function haversineSafe(a, b) {
  const R = 6371000;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = ((b.lat - a.lat) * Math.PI) / 180;
  const dl = ((b.lng - a.lng) * Math.PI) / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function formatTrip(trip) {
  const lines = [];
  if (trip.generic) lines.push("«Хятад» гэснийг Бээжин, PEK буудлаар авсан. Хот хэлбэл Шанхай, Гуанжоу гэж бич.");
  if (!trip.point && !trip.airports.destination) {
    lines.push("Очих газрыг олсонгүй. Хот эсвэл улсын нэрийг тодотго.");
    return lines.join("\n");
  }
  if (trip.distanceM != null) {
    lines.push(`Шулуун зай ${(trip.distanceM / 1000).toFixed(0)} км.`);
  }
  if (trip.drive?.drive) {
    lines.push(`Машинаар: ${formatLeg(trip.drive.drive)}.`);
  } else if (trip.distanceM > 15000) {
    lines.push("Машины замын минут энэ удаад ирсэнгүй. Шулуун зайг цаг болгож хувиргаагүй.");
  }
  if (trip.drive?.walk && !trip.drive.walk.unavailable && trip.drive.walk.durationSec) {
    lines.push(`Явганаар: ${formatLeg(trip.drive.walk)}.`);
  } else if (trip.distanceM > 15000) {
    lines.push("Явган явах зай биш.");
  }
  if (!trip.needsFlight) {
    lines.push("Энэ зай хотын доторх тул нислэг хайсангүй.");
    return lines.join("\n");
  }
  const from = trip.airports.origin;
  const to = trip.airports.destination;
  lines.push(`Нислэг: ${from.city} (${from.code}) → ${to.city} (${to.code}), ${trip.flights?.date}.`);
  if (!trip.flights?.configured) {
    lines.push("Хуваарь гаргасангүй: Amadeus түлхүүр .env файлд байхгүй. Цаг, үнэ зохиогоогүй.");
    return lines.join("\n");
  }
  if (trip.flights.error) {
    lines.push(`Нислэгийн эх үүсвэр алдаа өглөө: ${trip.flights.error}`);
    return lines.join("\n");
  }
  if (!trip.flights.offers.length) {
    lines.push(`${trip.flights.source} энэ өдөрт санал буцаасангүй.`);
    return lines.join("\n");
  }
  for (const offer of trip.flights.offers) {
    const first = offer.segments[0];
    const last = offer.segments[offer.segments.length - 1];
    const price = offer.price ? `, ${offer.price} ${offer.currency}` : "";
    lines.push(
      `${first.carrier} ${first.code}${first.number}: ${first.depart.replace("T", " ")} → ${last.arrive.replace("T", " ")}, ${offer.durationMin} мин, буудал ${offer.stops}${price}. Эх сурвалж: ${trip.flights.source}.`,
    );
  }
  return lines.join("\n");
}

const DECLS = [
  {
    name: "search_nearby_food",
    description: "Find restaurants and cafes around a point and attach drive plus walk minutes.",
    parameters: {
      type: "object",
      properties: {
        radius_m: { type: "number" },
        query: { type: "string" },
        place_name: { type: "string", description: "City name if the user asked around a city, otherwise empty." },
      },
    },
  },
  {
    name: "plan_trip",
    description: "Resolve how to reach a destination, including flight schedules when the distance requires flying.",
    parameters: {
      type: "object",
      properties: {
        destination: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["destination"],
    },
  },
  {
    name: "get_weather",
    description: "Current temperature, wind, and precipitation alert for the user.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "get_my_day",
    description: "Today's schedule, reminders, hydration, and sleep energy.",
    parameters: { type: "object", properties: {} },
  },
];

async function runTool(name, args, ctx) {
  if (name === "search_nearby_food") {
    let origin = ctx.origin;
    let label = ctx.locationLabel;
    if (args.place_name) {
      const point = await geocode(args.place_name);
      if (point) {
        origin = point;
        label = args.place_name;
      }
    }
    const found = await findFood(origin, Number(args.radius_m) || ctx.parsed.radiusM || 1500, args.query || ctx.message, label);
    return found;
  }
  if (name === "plan_trip") {
    const parsed = {
      ...ctx.parsed,
      destination: {
        place: null,
        query: args.destination,
      },
      date: args.date || ctx.parsed.date || addDays(localParts().date, 1),
    };
    const known = (await import("./places.mjs")).matchPlace(args.destination || "");
    if (known) parsed.destination.place = known;
    return planTrip(ctx.origin, parsed);
  }
  if (name === "get_weather") return ctx.weather;
  if (name === "get_my_day") {
    return {
      schedule: ctx.schedule || todaySchedule(),
      reminders: ctx.reminders,
      hydration: ctx.hydration,
      energy: ctx.energy,
    };
  }
  return { error: "unknown tool" };
}

export const UNCLEAR_REPLY = "Уучлаарай. Сайн ойлгосонгүй. Дахиад хэлнэ үү. Эсвэл бичиж өгнө үү.";

export function markUnclear(remote) {
  if (!/\[UNCLEAR\]/i.test(remote.reply || "")) return remote;
  return { ...remote, reply: UNCLEAR_REPLY, unclear: true };
}

async function remoteAnswer(id, ctx) {
  const cards = { places: null, trip: null };
  const tool = async (name, args) => {
    const result = await runTool(name, args, ctx);
    if (name === "search_nearby_food") cards.places = result;
    if (name === "plan_trip") cards.trip = result;
    return result;
  };
  const remote = await chat(id, ctx.message, ctx, DECLS, tool);
  return markUnclear({ ...remote, cards });
}

async function fillCards(remote, ctx) {
  const { parsed } = ctx;
  if (parsed.intent === "places" || parsed.intent === "places_there") {
    if (!remote.cards.places) {
      let origin = ctx.origin;
      let label = ctx.locationLabel;
      if (parsed.intent === "places_there" && parsed.destination.query) {
        const point = await geocode(parsed.destination.query);
        if (point) {
          origin = point;
          label = parsed.destination.query;
        }
      }
      remote.cards.places = await findFood(origin, parsed.radiusM, ctx.message, label);
    }
    if (!remote.reply) remote.reply = formatPlaces(remote.cards.places);
  }
  if (parsed.intent === "trip" && !remote.cards.trip) {
    remote.cards.trip = await planTrip(ctx.origin, parsed);
    if (!remote.reply) remote.reply = formatTrip(remote.cards.trip);
  }
  if (!remote.reply) remote.reply = "Хариу хоосон ирлээ. Асуултаа арай тодотгоно уу.";
  return remote;
}

async function localAnswer(ctx) {
  const { parsed } = ctx;
  const cards = { places: null, trip: null };
  if (parsed.intent === "places" || parsed.intent === "places_there") {
    let origin = ctx.origin;
    let label = ctx.locationLabel;
    if (parsed.intent === "places_there" && parsed.destination.query) {
      const point = await geocode(parsed.destination.query);
      if (point) {
        origin = point;
        label = parsed.destination.query;
      }
    }
    cards.places = await findFood(origin, parsed.radiusM, ctx.message, label);
    return { reply: formatPlaces(cards.places), cards, provider: "дотоод чиглүүлэгч" };
  }
  if (parsed.intent === "trip") {
    cards.trip = await planTrip(ctx.origin, parsed);
    return { reply: formatTrip(cards.trip), cards, provider: "дотоод чиглүүлэгч" };
  }
  if (parsed.intent === "weather" && ctx.weather) {
    return { reply: ctx.weather.summary, cards, provider: "дотоод чиглүүлэгч" };
  }
  if (parsed.intent === "day") {
    const lines = (ctx.schedule || todaySchedule()).map((item) => (item.start ? `${item.start}–${item.end} ${item.title}` : item.title));
    const reminders = (ctx.reminders || []).map((item) => `${item.due} ${item.title}`).join(", ");
    return {
      reply: `Өнөөдрийн хуваарь:\n${lines.join("\n")}\nСануулга: ${reminders || "байхгүй"}.`,
      cards,
      provider: "дотоод чиглүүлэгч",
    };
  }
  if (parsed.intent === "water" && ctx.hydration) {
    const drunk = (ctx.hydration.logs || []).reduce((sum, item) => sum + item.amountMl, 0);
    return {
      reply: `Өнөөдрийн усны зорилт ${ctx.hydration.targetMl || "тооцоогүй"} мл. Уусан ${drunk} мл. ${ctx.hydration.reason || ""}`,
      cards,
      provider: "дотоод чиглүүлэгч",
    };
  }
  return { reply: UNCLEAR_REPLY, unclear: true, cards, provider: "дотоод чиглүүлэгч" };
}

export async function answer(ctx) {
  const parsed = parseAsk(ctx.message);
  const full = { ...ctx, parsed };
  const ready = configuredProviders();
  const choice = ctx.provider || "auto";
  if (choice === "all" && ready.length) {
    const settled = await Promise.allSettled(ready.map((id) => remoteAnswer(id, full).then((remote) => fillCards(remote, full))));
    const answers = settled.map((item, index) =>
      item.status === "fulfilled"
        ? { providerId: ready[index], provider: item.value.provider, text: item.value.reply }
        : {
            providerId: ready[index],
            provider: providerLabel(ready[index]),
            error: (item.reason?.message || "Алдаа").replace(new RegExp(`^${providerLabel(ready[index])}:\\s*`), ""),
          },
    );
    const first = settled.find((item) => item.status === "fulfilled")?.value;
    if (!first) {
      const fallback = await localAnswer(full);
      fallback.answers = answers;
      fallback.note = "Бүх AI алдаа өглөө.";
      return fallback;
    }
    return { reply: first.reply, unclear: first.unclear, cards: first.cards, provider: `${answers.filter((item) => !item.error).length} AI`, answers };
  }
  const order = choice === "auto" || choice === "all" ? ready : [choice, ...ready.filter((id) => id !== choice)];
  const errors = [];
  for (const id of order) {
    try {
      const remote = await fillCards(await remoteAnswer(id, full), full);
      if (errors.length) remote.note = errors.join(" · ");
      return remote;
    } catch (error) {
      errors.push(error.message);
    }
  }
  const fallback = await localAnswer(full);
  if (errors.length) fallback.note = errors.join(" · ");
  else if (choice !== "auto") fallback.note = `${providerLabel(choice)} түлхүүр .env файлд алга.`;
  return fallback;
}
