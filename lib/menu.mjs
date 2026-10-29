// The kitchen's daily menu: dishes per meal with calories estimated by AI (or typed in by the kitchen).
import { randomBytes } from "node:crypto";
import { addDays } from "../public/js/workstats.js";
import { MENU_CATEGORIES, MENU_CATEGORY_LABEL, MENU_MEALS, MENU_MEAL_LABEL } from "../public/js/menulabels.js";
import { cleanText } from "./personal.mjs";

export { MENU_CATEGORIES, MENU_CATEGORY_LABEL, MENU_MEALS, MENU_MEAL_LABEL };
export const MENU_PAST_DAYS = 7;
export const MENU_AHEAD_DAYS = 14;

const KEEP_DAYS = 62;
const MAX_ITEMS_PER_DAY = 80;
const MAX_KCAL = 5000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ensureMenu(db) {
  if (db.menu && typeof db.menu === "object" && db.menu.days) return false;
  db.menu = { days: {} };
  return true;
}

/** The dates the kitchen may edit: a week back for corrections, two weeks ahead for planning. */
export function menuRange(today) {
  return { min: addDays(today, -MENU_PAST_DAYS), max: addDays(today, MENU_AHEAD_DAYS) };
}

export function menuDate(value, today) {
  const { min, max } = menuRange(today);
  return DATE.test(value || "") && value >= min && value <= max ? value : null;
}

function number(value, min, max) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.round(parsed) : undefined;
}

/** Validates a dish from the kitchen form; `kcal` stays null when AI should estimate it. */
export function cleanItem(body) {
  const meal = MENU_MEALS.includes(body?.meal) ? body.meal : null;
  if (!meal) return { error: "Хоолны цагаа сонгоно уу" };
  const category = MENU_CATEGORIES.includes(body?.category) ? body.category : null;
  if (!category) return { error: "Төрлөө сонгоно уу" };
  const name = cleanText(body?.name, 80);
  if (!name) return { error: "Хоолны нэр 1–80 тэмдэгт, < > тэмдэггүй байна" };
  const portion = number(body?.portion, 1, 2000);
  if (portion === undefined) return { error: "Порц 1–2000 г/мл байна" };
  const kcal = number(body?.kcal, 0, MAX_KCAL);
  if (kcal === undefined) return { error: `Калори 0–${MAX_KCAL} ккал байна` };
  const note = body?.note ? cleanText(body.note, 120) : null;
  if (body?.note && !note) return { error: "Тайлбар 120 тэмдэгтээс ихгүй" };
  return { item: { meal, category, name, portion, unit: category === "drink" || category === "soup" ? "мл" : "г", kcal, note } };
}

const SYSTEM = [
  "You are a nutritionist estimating calories for a workplace canteen in Mongolia.",
  "Dish names are usually Mongolian (Cyrillic) and may be Mongolian national dishes such as бууз, хуушуур, цуйван, банштай шөл, гурилтай шөл, хуурга, бантан, сүүтэй цай.",
  "Assume a typical canteen recipe. If no portion is given, assume a typical single canteen serving and report its size.",
  "Answer with one JSON object only, no prose: {\"kcal\": number, \"protein_g\": number, \"fat_g\": number, \"carbs_g\": number, \"portion\": number, \"note\": string}.",
  "portion is grams for food or millilitres for drinks and soups. note is a short Mongolian explanation (max 80 characters) of what you assumed.",
].join(" ");

export function nutritionPrompt(item) {
  return [
    `Dish: ${item.name}`,
    `Type: ${MENU_CATEGORY_LABEL[item.category]} (${item.category})`,
    `Meal: ${MENU_MEAL_LABEL[item.meal]}`,
    item.portion ? `Portion: ${item.portion} ${item.unit === "мл" ? "ml" : "g"}` : "Portion: not given, assume a typical single serving",
  ].join("\n");
}

export const NUTRITION_SYSTEM = SYSTEM;

/** Checks an AI estimate and keeps only sane numbers. */
export function cleanNutrition(data, item) {
  const kcal = number(data?.kcal, 0, MAX_KCAL);
  if (kcal == null) throw new Error("AI калори тооцож чадсангүй");
  const grams = (value) => number(value, 0, 500) ?? null;
  const portion = item.portion || number(data?.portion, 1, 2000) || null;
  const aiNote = typeof data?.note === "string" ? cleanText(data.note.slice(0, 120), 120) : null;
  return { kcal, protein: grams(data?.protein_g), fat: grams(data?.fat_g), carbs: grams(data?.carbs_g), portion, aiNote };
}

export function menuItems(db, date) {
  const items = db.menu?.days?.[date] || [];
  const order = (item) => MENU_MEALS.indexOf(item.meal) * 10 + MENU_CATEGORIES.indexOf(item.category);
  return [...items].sort((a, b) => order(a) - order(b) || a.at.localeCompare(b.at));
}

/** The meals a shift eats, in the order they come: a night shift's breakfast is served the next morning as it ends. */
export const SHIFT_MEALS = { day: ["breakfast", "lunch", "dinner"], night: ["dinner", "night", "breakfast"] };

export function shiftMenu(db, date, kind) {
  const shift = kind === "night" ? "night" : "day";
  const meals = SHIFT_MEALS[shift];
  const morning = shift === "night" ? addDays(date, 1) : date;
  const items =
    shift === "night"
      ? [...menuItems(db, date).filter((item) => meals.includes(item.meal) && item.meal !== "breakfast"), ...menuItems(db, morning).filter((item) => item.meal === "breakfast")]
      : menuItems(db, date).filter((item) => meals.includes(item.meal));
  return { shift, meals, morning, items };
}

export function menuTotals(items) {
  const meals = Object.fromEntries(MENU_MEALS.map((meal) => [meal, 0]));
  for (const item of items) meals[item.meal] += item.kcal || 0;
  return { meals, total: Object.values(meals).reduce((sum, value) => sum + value, 0), pending: items.filter((item) => item.kcal == null).length };
}

export function findItem(db, id) {
  for (const [date, items] of Object.entries(db.menu?.days || {})) {
    const item = items.find((entry) => entry.id === id);
    if (item) return { date, item };
  }
  return null;
}

export function addItem(db, date, item, by, today, now = Date.now()) {
  ensureMenu(db);
  const day = (db.menu.days[date] ||= []);
  if (day.length >= MAX_ITEMS_PER_DAY) return { error: `Нэг өдөрт ${MAX_ITEMS_PER_DAY}-аас олон хоол оруулах боломжгүй` };
  const entry = { id: `mn_${randomBytes(6).toString("hex")}`, ...item, by, at: new Date(now).toISOString() };
  day.push(entry);
  pruneMenu(db, today);
  return { item: entry };
}

export function removeItem(db, id) {
  const found = findItem(db, id);
  if (!found) return false;
  db.menu.days[found.date] = db.menu.days[found.date].filter((item) => item.id !== id);
  if (!db.menu.days[found.date].length) delete db.menu.days[found.date];
  return true;
}

export function pruneMenu(db, today) {
  const floor = addDays(today, -KEEP_DAYS);
  for (const date of Object.keys(db.menu?.days || {})) if (date < floor) delete db.menu.days[date];
}

export function publicItem(item) {
  const { id, meal, category, name, portion, unit, kcal, protein, fat, carbs, note, aiNote, source } = item;
  return { id, meal, category, name, portion, unit, kcal, protein, fat, carbs, note, aiNote, source };
}

/** A rough daily energy need: about 28 kcal/kg on a day off and 32 on a shift day, 2000/2300 without a weight. */
export function dailyKcal(weightKg, working) {
  if (!(weightKg >= 30 && weightKg <= 250)) return working ? 2300 : 2000;
  return Math.round((weightKg * (working ? 32 : 28)) / 50) * 50;
}

/** Marks a dish eaten or not; the breakfast/lunch/dinner flags follow what was eaten. */
export function toggleEaten(day, items, id) {
  const eaten = new Set((day.eaten || []).filter((value) => items.some((item) => item.id === value)));
  if (eaten.has(id)) eaten.delete(id);
  else eaten.add(id);
  day.eaten = [...eaten];
  const flag = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", night: "dinner" };
  day.meals = { ...day.meals };
  for (const meal of ["breakfast", "lunch", "dinner"]) {
    const served = items.filter((item) => flag[item.meal] === meal);
    if (served.length) day.meals[meal] = served.some((item) => eaten.has(item.id));
  }
  return day;
}

export function eatenKcal(items, eaten) {
  const ids = new Set(eaten || []);
  return items.filter((item) => ids.has(item.id)).reduce((sum, item) => sum + (item.kcal || 0), 0);
}
