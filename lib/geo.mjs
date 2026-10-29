import {
  AIRPORTS,
  airportByCode,
  haversineM,
  nearestAirport,
} from "./places.mjs";

const UA = "HOLO-Companion/1.0 (local personal assistant)";

async function readJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
      ...(options.headers || {}),
    },
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 20000),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  if (!res.ok) {
    const detail = body?.error_description || body?.error?.message || body?.message || text.slice(0, 160);
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return body;
}

export async function reverseGeocode(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");
  const body = await readJson(url, { timeoutMs: 8000 });
  const address = body.address || {};
  return address.suburb || address.city || address.town || address.state || body.name || "Байршил";
}

export async function geocode(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const body = await readJson(url, { timeoutMs: 8000 });
  const hit = body?.[0];
  if (!hit) return null;
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: hit.display_name,
  };
}

const OSM_TYPES = {
  restaurant: "Ресторан",
  cafe: "Кафе",
  fast_food: "Түргэн хоол",
  bar: "Баар",
  pub: "Паб",
  hospital: "Эмнэлэг",
  clinic: "Эмнэлэг",
  pharmacy: "Эмийн сан",
  school: "Сургууль",
  university: "Их сургууль",
  college: "Коллеж",
  kindergarten: "Цэцэрлэг",
  bank: "Банк",
  atm: "АТМ",
  hotel: "Зочид буудал",
  museum: "Музей",
  theatre: "Театр",
  cinema: "Кино театр",
  square: "Талбай",
  park: "Цэцэрлэгт хүрээлэн",
  place_of_worship: "Шүтлэгийн газар",
  monastery: "Хийд",
  attraction: "Үзвэр",
  monument: "Хөшөө дурсгал",
  memorial: "Дурсгал",
  peak: "Уулын оргил",
  government: "Төрийн байгууллага",
  townhall: "Захиргаа",
  embassy: "Элчин сайдын яам",
  police: "Цагдаа",
  post_office: "Шуудан",
  fuel: "Шатахуун түгээх станц",
  parking: "Зогсоол",
  bus_stop: "Автобусны буудал",
  station: "Буудал",
  aerodrome: "Нисэх буудал",
  mall: "Худалдааны төв",
  supermarket: "Супермаркет",
  department_store: "Их дэлгүүр",
  clothes: "Хувцасны дэлгүүр",
  cosmetics: "Гоо сайхны дэлгүүр",
  beauty: "Гоо сайхны салон",
  dentist: "Шүдний эмнэлэг",
  library: "Номын сан",
  books: "Номын дэлгүүр",
  convenience: "Дэлгүүр",
  marketplace: "Зах",
  stadium: "Цэнгэлдэх хүрээлэн",
  sports_centre: "Спорт заал",
  apartments: "Орон сууц",
  residential: "Орон сууцны бүс",
  office: "Оффис",
  suburb: "Хороолол",
  city: "Хот",
  town: "Суурин",
  village: "Тосгон",
};

function osmType(hit) {
  if (hit.category === "highway" && hit.type !== "bus_stop") return "Гудамж, зам";
  if (hit.category === "building" && hit.type === "yes") return "Барилга";
  return OSM_TYPES[hit.type] || [hit.category, hit.type].filter((part) => part && part !== "yes").join(" · ");
}

function osmPlace(hit) {
  const tags = hit.extratags || {};
  const address = hit.address || {};
  const street = [address.road, address.house_number].filter(Boolean).join(" ");
  return {
    name: hit.namedetails?.["name:mn"] || hit.name || hit.namedetails?.name || hit.display_name?.split(",")[0] || "Нэргүй газар",
    type: osmType(hit),
    address: [street, address.suburb || address.city_district, address.city || address.town || address.state]
      .filter(Boolean)
      .join(", ") || hit.display_name || "",
    phone: tags.phone || tags["contact:phone"] || null,
    website: tags.website || tags["contact:website"] || null,
    hours: tags.opening_hours ? [tags.opening_hours] : [],
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    link: hit.osm_type && hit.osm_id ? `https://www.openstreetmap.org/${hit.osm_type}/${hit.osm_id}` : null,
    source: "OpenStreetMap",
  };
}

export async function placeAt(lat, lng, name) {
  const common = (url) => {
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("extratags", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "mn");
    return url;
  };
  if (name) {
    const url = common(new URL("https://nominatim.openstreetmap.org/search"));
    const d = 0.01;
    url.searchParams.set("q", name);
    url.searchParams.set("viewbox", `${lng - d},${lat + d},${lng + d},${lat - d}`);
    url.searchParams.set("bounded", "1");
    url.searchParams.set("limit", "5");
    const hits = await readJson(url, { timeoutMs: 8000 });
    if (hits?.length) {
      const nearest = hits.reduce((best, hit) =>
        haversineM(lat, lng, Number(hit.lat), Number(hit.lon)) < haversineM(lat, lng, Number(best.lat), Number(best.lon)) ? hit : best,
      );
      return osmPlace(nearest);
    }
  }
  const url = common(new URL("https://nominatim.openstreetmap.org/reverse"));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("zoom", "18");
  const hit = await readJson(url, { timeoutMs: 8000 });
  if (!hit || hit.error) return null;
  const place = osmPlace(hit);
  if (name) place.name = name;
  return place;
}

export async function searchPlaces(query, lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("accept-language", "mn");
  url.searchParams.set("limit", "6");
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    const d = 0.5;
    url.searchParams.set("viewbox", `${lng - d},${lat + d},${lng + d},${lat - d}`);
  }
  const hits = await readJson(url, { timeoutMs: 8000 });
  const places = [];
  for (const place of (hits || []).map(osmPlace)) {
    const twin = places.some((seen) => seen.name === place.name && haversineM(seen.lat, seen.lng, place.lat, place.lng) < 300);
    if (!twin) places.push(place);
  }
  return places;
}

function amenitiesFor(query) {
  const text = String(query || "").toLowerCase();
  if (/кафе|cafe|coffee|кофе/.test(text)) return ["cafe"];
  if (/ресторан|restaurant/.test(text)) return ["restaurant"];
  return ["restaurant", "cafe", "fast_food"];
}

export async function searchFood(lat, lng, radiusM, query) {
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      return await googleFood(lat, lng, radiusM, query);
    } catch {
      /* OSM fallback below */
    }
  }
  return osmFood(lat, lng, radiusM, query);
}

async function googleFood(lat, lng, radiusM, query) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(radiusM));
  url.searchParams.set("type", amenitiesFor(query)[0] === "cafe" ? "cafe" : "restaurant");
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);
  const body = await readJson(url);
  if (body.status && body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new Error(body.error_message || body.status);
  }
  const places = (body.results || []).slice(0, 15).map((item) => ({
    name: item.name,
    lat: item.geometry.location.lat,
    lng: item.geometry.location.lng,
    category: amenitiesFor(query)[0] === "cafe" ? "кафе" : "хоолны газар",
    address: item.vicinity || "",
    rating: item.rating ?? null,
    openNow: item.opening_hours?.open_now ?? null,
    source: "Google Maps",
  }));
  return { source: "Google Maps", places };
}

async function osmFood(lat, lng, radiusM, query) {
  const amenities = amenitiesFor(query);
  const clauses = amenities
    .map((amenity) => `node["amenity"="${amenity}"](around:${Math.round(radiusM)},${lat},${lng});`)
    .join("");
  const overpass = `[out:json][timeout:25];(${clauses});out 20;`;
  try {
    const body = await readJson("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpass)}`,
      timeoutMs: 25000,
    });
    const places = (body.elements || [])
      .filter((item) => item.lat && item.lon && item.tags?.name)
      .slice(0, 15)
      .map((item) => ({
        name: item.tags.name,
        lat: item.lat,
        lng: item.lon,
        category: categoryLabel(item.tags.amenity),
        address: item.tags["addr:street"] || "",
        rating: null,
        openNow: null,
        source: "OpenStreetMap",
      }));
    if (places.length) return { source: "OpenStreetMap", places };
  } catch {
    /* nominatim fallback */
  }
  const deltaLat = radiusM / 111000;
  const deltaLng = radiusM / (111000 * Math.cos((lat * Math.PI) / 180));
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", amenities[0] === "cafe" ? "cafe" : "restaurant");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "15");
  url.searchParams.set("bounded", "1");
  url.searchParams.set(
    "viewbox",
    `${lng - deltaLng},${lat + deltaLat},${lng + deltaLng},${lat - deltaLat}`,
  );
  const body = await readJson(url);
  const places = (body || []).map((item) => ({
    name: item.name || item.display_name.split(",")[0],
    lat: Number(item.lat),
    lng: Number(item.lon),
    category: "хоолны газар",
    address: item.display_name,
    rating: null,
    openNow: null,
    source: "OpenStreetMap",
  }));
  return { source: "OpenStreetMap", places };
}

function categoryLabel(amenity) {
  if (amenity === "cafe") return "кафе";
  if (amenity === "fast_food") return "түргэн хоол";
  return "хоолны газар";
}

export function mapsLink(origin, dest, mode) {
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destination", `${dest.lat},${dest.lng}`);
  url.searchParams.set("travelmode", mode === "walk" ? "walking" : "driving");
  return url.toString();
}

function trafficLevel(staticSec, trafficSec) {
  if (!staticSec || !trafficSec) return "unknown";
  const ratio = trafficSec / staticSec;
  if (ratio < 1.15) return "light";
  if (ratio < 1.4) return "medium";
  return "heavy";
}

export async function attachRoutes(origin, places, { walk = true } = {}) {
  const withDistance = places.map((place) => ({
    ...place,
    distanceM: Math.round(haversineM(origin, place)),
    drive: null,
    walk: null,
    driveLink: mapsLink(origin, place, "drive"),
    walkLink: mapsLink(origin, place, "walk"),
  }));
  withDistance.sort((a, b) => a.distanceM - b.distanceM);
  const routed = withDistance.slice(0, 12);
  if (!routed.length) return [];
  let drive = null;
  let walked = null;
  if (process.env.GOOGLE_MAPS_API_KEY) {
    try {
      drive = await googleMatrix(origin, routed, "driving");
      if (walk) walked = await googleMatrix(origin, routed.filter((place) => place.distanceM <= 15000), "walking");
    } catch {
      drive = null;
    }
  }
  if (!drive) {
    drive = await osrmMatrix(origin, routed, "driving");
    if (walk) walked = await osrmMatrix(origin, routed.filter((place) => place.distanceM <= 15000), "walking");
  }
  return routed.map((place, index) => {
    const driveLeg = drive?.[index] || null;
    const walkIndex = routed.filter((item) => item.distanceM <= 15000).indexOf(place);
    const walkLeg = walkIndex >= 0 ? walked?.[walkIndex] || null : null;
    return {
      ...place,
      drive: driveLeg,
      walk:
        place.distanceM > 15000
          ? { unavailable: true }
          : walkLeg,
    };
  });
}

async function googleMatrix(origin, places, mode) {
  if (!places.length) return [];
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
  url.searchParams.set("destinations", places.map((place) => `${place.lat},${place.lng}`).join("|"));
  url.searchParams.set("mode", mode);
  if (mode === "driving") url.searchParams.set("departure_time", "now");
  url.searchParams.set("key", process.env.GOOGLE_MAPS_API_KEY);
  const body = await readJson(url);
  if (body.status && body.status !== "OK") throw new Error(body.error_message || body.status);
  const elements = body.rows?.[0]?.elements || [];
  return elements.map((element) => {
    if (element.status !== "OK") return null;
    const durationSec = element.duration?.value ?? null;
    const trafficSec = element.duration_in_traffic?.value ?? null;
    return {
      durationSec,
      durationTrafficSec: mode === "driving" ? trafficSec : null,
      distanceM: element.distance?.value ?? null,
      traffic: mode === "driving" ? trafficLevel(durationSec, trafficSec) : "unknown",
      source: mode === "driving" && trafficSec ? "Google Maps, түгжрэлтэй" : "Google Maps",
    };
  });
}

async function osrmMatrix(origin, places, profile) {
  if (!places.length) return [];
  const coords = [origin, ...places].map((place) => `${place.lng},${place.lat}`).join(";");
  const pull = async (annotations) => {
    const url = `https://router.project-osrm.org/table/v1/${profile}/${coords}?sources=0&annotations=${annotations}`;
    return readJson(url, { timeoutMs: 20000 });
  };
  try {
    let body;
    try {
      body = await pull("duration,distance");
    } catch {
      body = await pull("duration");
    }
    const durations = body.durations?.[0] || [];
    const distances = body.distances?.[0] || [];
    return places.map((_, index) => {
      const durationSec = durations[index + 1];
      const distanceM = distances[index + 1];
      if (durationSec == null) return null;
      return {
        durationSec: Math.round(durationSec),
        durationTrafficSec: null,
        distanceM: distanceM == null ? null : Math.round(distanceM),
        traffic: "unknown",
        source: "OSRM, түгжрэлгүй",
      };
    });
  } catch {
    return places.map(() => null);
  }
}

const AIRLINES = {
  OM: "MIAT",
  CA: "Air China",
  CZ: "China Southern",
  MU: "China Eastern",
  HU: "Hainan",
  MF: "XiamenAir",
  KE: "Korean Air",
  OZ: "Asiana",
  JL: "JAL",
  NH: "ANA",
  TK: "Turkish",
  SU: "Aeroflot",
};

let amadeusCache = null;

async function amadeusToken() {
  if (amadeusCache && amadeusCache.until > Date.now() + 15000) return amadeusCache.token;
  const host = process.env.AMADEUS_HOST === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
  const body = await readJson(`${host}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID,
      client_secret: process.env.AMADEUS_CLIENT_SECRET,
    }),
  });
  amadeusCache = { token: body.access_token, until: Date.now() + body.expires_in * 1000, host };
  return body.access_token;
}

function parseDuration(value) {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(value || "");
  if (!match) return null;
  return Number(match[1] || 0) * 60 + Number(match[2] || 0);
}

export async function searchFlights(originCode, destCode, date) {
  if (!process.env.AMADEUS_CLIENT_ID || !process.env.AMADEUS_CLIENT_SECRET) {
    return {
      configured: false,
      origin: originCode,
      destination: destCode,
      date,
      offers: [],
      source: "Amadeus",
    };
  }
  const host = process.env.AMADEUS_HOST === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
  const token = await amadeusToken();
  const url = new URL(`${host}/v2/shopping/flight-offers`);
  url.searchParams.set("originLocationCode", originCode);
  url.searchParams.set("destinationLocationCode", destCode);
  url.searchParams.set("departureDate", date);
  url.searchParams.set("adults", "1");
  url.searchParams.set("max", "6");
  url.searchParams.set("currencyCode", "USD");
  const body = await readJson(url, { headers: { Authorization: `Bearer ${token}` } });
  const offers = (body.data || []).map((offer) => {
    const itinerary = offer.itineraries?.[0];
    const segments = (itinerary?.segments || []).map((segment) => ({
      carrier: AIRLINES[segment.carrierCode] || segment.carrierCode,
      code: segment.carrierCode,
      number: segment.number,
      from: segment.departure.iataCode,
      to: segment.arrival.iataCode,
      depart: segment.departure.at,
      arrive: segment.arrival.at,
    }));
    return {
      durationMin: parseDuration(itinerary?.duration),
      stops: Math.max(0, segments.length - 1),
      segments,
      price: offer.price?.total || null,
      currency: offer.price?.currency || null,
    };
  });
  return {
    configured: true,
    origin: originCode,
    destination: destCode,
    date,
    offers,
    source: host.includes("test") ? "Amadeus test" : "Amadeus",
  };
}

export function flightSearchLink(originCode, destCode, date) {
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(`flights from ${originCode} to ${destCode} on ${date}`)}`;
}

export function resolveAirports(originPoint, destinationPoint, namedCode) {
  const origin = nearestAirport(originPoint.lat, originPoint.lng) || airportByCode("ULN");
  let destination = namedCode ? airportByCode(namedCode) : null;
  if (!destination && destinationPoint) destination = nearestAirport(destinationPoint.lat, destinationPoint.lng, 80);
  return { origin, destination };
}

export { AIRPORTS };
