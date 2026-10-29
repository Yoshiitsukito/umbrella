import test from "node:test";
import assert from "node:assert/strict";
import { fetchLiveWeather, owmCode } from "../lib/liveweather.mjs";

test("OpenWeatherMap condition ids map to WMO codes", () => {
  assert.equal(owmCode(800), 0);
  assert.equal(owmCode(801), 1);
  assert.equal(owmCode(804), 3);
  assert.equal(owmCode(500), 61);
  assert.equal(owmCode(502), 65);
  assert.equal(owmCode(601), 73);
  assert.equal(owmCode(211), 95);
  assert.equal(owmCode(741), 45);
});

function mockFetch(routes) {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const href = String(url);
    const hit = Object.entries(routes).find(([part]) => href.includes(part));
    if (!hit) throw new Error(`unexpected ${href}`);
    const [status, body] = hit[1];
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  };
  return () => {
    globalThis.fetch = saved;
  };
}

function meteoBody(now) {
  const hour = Math.floor(now / 3600000) * 3600;
  const quarter = Math.floor(now / 900000) * 900;
  return {
    current: { time: quarter, temperature_2m: -0.6, apparent_temperature: -6, relative_humidity_2m: 78, wind_speed_10m: 5, wind_direction_10m: 320, weather_code: 2, is_day: 0, precipitation: 0, cloud_cover: 60 },
    hourly: {
      time: [hour, hour + 3600, hour + 7200],
      temperature_2m: [-0.6, -3.6, -5.3],
      precipitation_probability: [0, 10, 60],
      weather_code: [2, 3, 71],
      wind_speed_10m: [5, 5.2, 4],
      is_day: [0, 0, 0],
    },
    minutely_15: { time: [quarter - 900, quarter, quarter + 900], precipitation: [0, 0, 0] },
  };
}

test("station observation drives current weather, Open-Meteo the forecast", async () => {
  const saved = process.env.OPENWEATHERMAP_API_KEY;
  process.env.OPENWEATHERMAP_API_KEY = "test";
  const now = Date.now();
  const restore = mockFetch({
    "openweathermap.org": [200, { dt: Math.floor(now / 1000), name: "Ulaanbaatar", main: { temp: -1.25, feels_like: -5.99, humidity: 51 }, wind: { speed: 4.24, deg: 304 }, clouds: { all: 20 }, weather: [{ id: 801 }] }],
    "open-meteo.com": [200, meteoBody(now)],
  });
  try {
    const weather = await fetchLiveWeather(47.9, 106.9);
    assert.equal(weather.tempC, -1.2);
    assert.equal(weather.feelsLikeC, -6);
    assert.equal(weather.code, 1);
    assert.equal(weather.source, "OpenWeatherMap · Ulaanbaatar");
    assert.equal(weather.hourly.length, 3);
    assert.equal(weather.hourly[0].tempC, -1.2);
    assert.equal(weather.hourly[2].precipProb, 60);
    assert.equal(weather.precip.status, "clear");
    assert.match(weather.summary, /-1°C/);
  } finally {
    restore();
    if (saved === undefined) delete process.env.OPENWEATHERMAP_API_KEY;
    else process.env.OPENWEATHERMAP_API_KEY = saved;
  }
});

test("without a station Open-Meteo's current values are used, and rain now is ongoing", async () => {
  const saved = process.env.OPENWEATHERMAP_API_KEY;
  process.env.OPENWEATHERMAP_API_KEY = "test";
  const now = Date.now();
  const body = meteoBody(now);
  body.current.weather_code = 63;
  body.current.precipitation = 0.8;
  body.current.temperature_2m = 4;
  const restore = mockFetch({ "openweathermap.org": [401, { message: "Invalid API key" }], "open-meteo.com": [200, body] });
  try {
    const weather = await fetchLiveWeather(47.9, 106.9);
    assert.equal(weather.source, "Open-Meteo");
    assert.equal(weather.tempC, 4);
    assert.equal(weather.precip.status, "ongoing");
    assert.equal(weather.precip.kind, "rain");
  } finally {
    restore();
    if (saved === undefined) delete process.env.OPENWEATHERMAP_API_KEY;
    else process.env.OPENWEATHERMAP_API_KEY = saved;
  }
});
