// Finance, coal sales and environment arithmetic shared by the server and the pages: straight-line depreciation,
// coal grade, monitoring limits, weighbridge net weight, contract progress and one month's money.
import { BUDGET_CATS, ENV_METRICS, localDay } from "./minecore.js";

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export const COAL_GRADES = { premium: "Дээд зэрэг", standard: "Стандарт", low: "Бага илчлэгтэй" };

const indexOf = (month) => {
  const [year, number] = month.split("-").map(Number);
  return year * 12 + number - 1;
};
const round2 = (value) => Math.round(value * 100) / 100;
const total = (list, get) => list.reduce((sum, item) => sum + (Number(get(item)) || 0), 0);

export const monthOf = (value) => String(value || "").slice(0, 7);
/** The local (UTC+8) month of an ISO moment. */
export const momentMonth = (iso) => (iso ? localDay(Date.parse(iso)).slice(0, 7) : "");

export function addMonth(month, delta) {
  const at = indexOf(month) + delta;
  return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
}

export function daysIn(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).getUTCDate();
}

export function monthLabel(month) {
  const [year, number] = String(month).split("-");
  return `${year} оны ${Number(number)}-р сар`;
}

/**
 * Straight-line depreciation from the month after purchase to the end of `month`, stopping at disposal or at the
 * end of the useful life: the monthly charge, months charged, accumulated amount and book value.
 */
export function depreciation(asset, month) {
  const cost = Number(asset.cost) || 0;
  const salvage = Math.min(Number(asset.salvage) || 0, cost);
  const life = Math.max(1, Math.round((Number(asset.life) || 1) * 12));
  const monthly = (cost - salvage) / life;
  const start = indexOf(monthOf(asset.acquired)) + 1;
  let end = indexOf(month);
  if (asset.status === "disposed" && asset.disposedOn) end = Math.min(end, indexOf(monthOf(asset.disposedOn)));
  const months = Math.max(0, Math.min(life, end - start + 1));
  const accumulated = Math.round(monthly * months);
  return { monthly: Math.round(monthly), months, life, accumulated, book: cost - accumulated };
}

/** The depreciation that falls in one month. */
export const monthCharge = (asset, month) => depreciation(asset, month).accumulated - depreciation(asset, addMonth(month, -1)).accumulated;

/** Thermal coal grade from calorific value and ash. */
export function coalGrade(lab) {
  if (!lab) return null;
  if (lab.cv >= 6000 && lab.ash <= 15) return "premium";
  if (lab.cv >= 5000 && lab.ash <= 25) return "standard";
  return "low";
}

/** Weighbridge net weight in tonnes. */
export const netOf = (shipment) => Math.max(0, round2((Number(shipment.gross) || 0) - (Number(shipment.tare) || 0)));

/** "over" past a limit, "near" within 10% of it, otherwise "ok". */
export function envState(reading) {
  const spec = ENV_METRICS[reading.metric];
  if (!spec) return "ok";
  const value = Number(reading.value);
  if ((spec.max != null && value > spec.max) || (spec.min != null && value < spec.min)) return "over";
  if ((spec.max != null && value > spec.max * 0.9) || (spec.min != null && value < spec.min * 1.05)) return "near";
  return "ok";
}

/** What a request is worth: the purchase total, or the price a write-off is expected to fetch. */
export const requestValue = (name, item) => (name === "capex" ? (Number(item.qty) || 0) * (Number(item.price) || 0) : Number(item.value) || 0);

/** Tonnes shipped against a contract, what is left, and their value. */
export function saleProgress(sale, shipments) {
  const own = shipments.filter((item) => item.sale === sale.id);
  const shipped = round2(total(own, netOf));
  return { shipped, trucks: own.length, left: Math.max(0, round2(sale.tonnes - shipped)), value: Math.round(shipped * sale.price), share: sale.tonnes ? Math.min(1, shipped / sale.tonnes) : 0 };
}

/**
 * One month's money: coal revenue (net tonnes shipped × contract price), the gain or loss on approved write-offs,
 * costs entered by finance, fuel priced from the fuel log, depreciation, profit, and the budget beside each line.
 * `share` is the part of the month gone so far; a running month carries only that part of its depreciation.
 */
export function financeMonth({ fin, coal, ops, fuelPrice, share = 1 }, month) {
  const prices = new Map((coal.sales || []).map((item) => [item.id, item.price]));
  const shipped = (coal.shipments || []).filter((item) => momentMonth(item.at) === month);
  const revenue = Math.round(total(shipped, (item) => netOf(item) * (prices.get(item.sale) || 0)));
  const disposed = (fin.disposals || []).filter((item) => item.stage === "approved" && momentMonth(item.decidedAt) === month);
  const assetGain = Math.round(total(disposed, (item) => (item.value || 0) - (item.book || 0)));
  const costs = Object.fromEntries(Object.keys(BUDGET_CATS).map((key) => [key, 0]));
  for (const item of fin.costs || []) if (monthOf(item.date) === month && Object.hasOwn(costs, item.category)) costs[item.category] += item.amount;
  const liters = total((ops.fuel || []).filter((item) => momentMonth(item.at) === month), (item) => item.liters);
  costs.fuel = Math.round(liters * (Number(fuelPrice) || 0));
  const budget = Object.fromEntries(Object.keys(BUDGET_CATS).map((key) => [key, 0]));
  for (const item of fin.budgets || []) if (item.month === month && Object.hasOwn(budget, item.category)) budget[item.category] += item.amount;
  const costTotal = total(Object.values(costs), (value) => value);
  const charge = Math.round(total(fin.assets || [], (asset) => monthCharge(asset, month)) * Math.min(1, Math.max(0, share)));
  const income = revenue + assetGain;
  const profit = income - costTotal - charge;
  return {
    month,
    tonnes: round2(total(shipped, netOf)),
    trucks: shipped.length,
    revenue,
    assetGain,
    income,
    costs,
    costTotal,
    liters,
    depreciation: charge,
    share,
    budget,
    budgetTotal: total(Object.values(budget), (value) => value),
    profit,
    margin: income > 0 ? profit / income : null,
  };
}
