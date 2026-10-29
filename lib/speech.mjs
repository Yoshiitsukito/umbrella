const ONES = ["тэг", "нэг", "хоёр", "гурав", "дөрөв", "тав", "зургаа", "долоо", "найм", "ес"];
const ONES_ATTR = ["тэг", "нэг", "хоёр", "гурван", "дөрвөн", "таван", "зургаан", "долоон", "найман", "есөн"];
const TENS = ["", "арав", "хорь", "гуч", "дөч", "тавь", "жар", "дал", "ная", "ер"];
const TENS_ATTR = ["", "арван", "хорин", "гучин", "дөчин", "тавин", "жаран", "далан", "наян", "ерэн"];

// Mongolian numerals change form before a noun ("тав" alone, "таван минут" before a noun).
export function numberWords(value, attributive = false) {
  const n = Math.floor(Math.abs(Number(value)));
  if (!Number.isFinite(n) || n > 999_999) return String(value);
  if (n === 0) return "тэг";
  const parts = [];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (thousands) {
    const lead = thousands === 1 ? "" : `${numberWords(thousands, true)} `;
    parts.push(`${lead}${attributive && !rest ? "мянган" : "мянга"}`);
  }
  const hundreds = Math.floor(rest / 100);
  const below = rest % 100;
  if (hundreds) {
    const lead = hundreds === 1 ? "" : `${numberWords(hundreds, true)} `;
    parts.push(`${lead}${below || attributive ? "зуун" : "зуу"}`);
  }
  const tens = Math.floor(below / 10);
  const ones = below % 10;
  if (tens) parts.push(ones || attributive ? TENS_ATTR[tens] : TENS[tens]);
  if (ones) parts.push(attributive ? ONES_ATTR[ones] : ONES[ones]);
  return parts.join(" ");
}

const BEFORE_WORD = /^\s+\p{L}/u;

export function speakableMongolian(text) {
  return String(text ?? "")
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (match, hh, mm, offset, whole) => {
      const minutes = Number(mm);
      const hour = numberWords(hh, true);
      if (!minutes && /^\s*цаг/.test(whole.slice(offset + match.length))) return hour;
      return `${hour} цаг${minutes ? ` ${numberWords(minutes, true)} минут` : ""}`;
    })
    .replace(/(\d+)\s*%/g, (match, digits) => `${numberWords(digits, true)} хувь`)
    .replace(/(^|[\s(])[-−](?=\d)/g, "$1хасах ")
    .replace(/(\d+)[.,](\d)\d*/g, (match, whole, tenth) => `${whole} бүхэл аравны ${tenth}`)
    .replace(/\d+(-(?=\p{L}))?/gu, (match, hyphen, offset, whole) => {
      const digits = match.replace("-", "");
      if (hyphen) return numberWords(digits);
      return numberWords(digits, BEFORE_WORD.test(whole.slice(offset + match.length)));
    })
    .replace(/\s+/g, " ")
    .trim();
}
