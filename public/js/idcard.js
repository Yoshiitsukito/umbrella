function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function seedFrom(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function barcode(text) {
  const rand = random(seedFrom(`bar:${text}`));
  let x = 0;
  let bars = "";
  while (x < 140) {
    const width = 1 + Math.floor(rand() * 3.2);
    bars += `<rect x="${x}" width="${width}" height="40"/>`;
    x += width + 1 + Math.floor(rand() * 2.2);
  }
  return `<svg class="idc-barcode" viewBox="0 0 ${x} 40" preserveAspectRatio="none" aria-hidden="true">${bars}</svg>`;
}

const SILHOUETTE = `<svg class="idc-silhouette" viewBox="0 0 100 126" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="idc-sil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a4a4a"/><stop offset="1" stop-color="#1e1e1e"/></linearGradient></defs>
  <path fill="url(#idc-sil)" d="M50 18c11 0 19 9 19 22 0 9-4 17-9 21v6c13 3 26 10 30 24 2 7 3 20 3 35H7c0-15 1-28 3-35 4-14 17-21 30-24v-6c-5-4-9-12-9-21 0-13 8-22 19-22z"/>
</svg>`;

function qrSvg(text) {
  if (!window.qrcode) return "";
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 2, margin: 1, scalable: true });
}

const STATUS_MN = { ACTIVE: "ИДЭВХТЭЙ", SUSPENDED: "ТҮДГЭЛЗСЭН", REVOKED: "ЦУЦЛАГДСАН" };

export const CARD_TEXTS = [
  { side: "front", key: "brand", label: "Брэнд", value: "U.MBRELLA", max: 16 },
  { side: "front", key: "sub", label: "Дэд гарчиг", value: "КОРПОРАЦИ", max: 24 },
  { side: "front", key: "subAccent", label: "Дэд гарчиг (улаан)", value: "ХАМГААЛАЛТЫН ҮНЭМЛЭХ", max: 32 },
  { side: "front", key: "nameLabel", label: "Нэрийн шошго", value: "НЭР:", max: 16 },
  { side: "front", key: "classLabel", label: "Ангиллын шошго", value: "АНГИЛАЛ:", max: 16 },
  { side: "front", key: "projectLabel", label: "Төслийн шошго", value: "ТӨСӨЛ:", max: 16 },
  { side: "front", key: "idLabel", label: "ID дугаарын шошго", value: "ID ДУГААР:", max: 16 },
  { side: "front", key: "statusLabel", label: "Төлөвийн шошго", value: "ТӨЛӨВ:", max: 16 },
  { side: "front", key: "level", label: "Түвшний бичиг", value: "ЭРХИЙН ТҮВШИН", max: 24 },
  { side: "front", key: "band", label: "Улаан зурвас", value: "ЗӨВШӨӨРӨЛТЭЙ НЭВТРЭЛТ", max: 32 },
  { side: "front", key: "auth", label: "Олгосон байгууллага", value: "UMBRELLA КОРПОРАЦИ ОЛГОВ", max: 40 },
  { side: "front", key: "expiresLabel", label: "Хугацааны шошго", value: "ХҮЧИНТЭЙ:", max: 20 },
  { side: "front", key: "expiresSuffix", label: "Хугацааны төгсгөл", value: "ХҮРТЭЛ", max: 16 },
  { side: "back", key: "backTop", label: "Дээд бичиг", value: "UMBRELLA КОРПОРАЦИЙН ӨМЧ", max: 48 },
  { side: "back", key: "backTopAccent", label: "Дээд бичиг (улаан)", value: "РАККУН СИТИ", max: 32 },
  { side: "back", key: "noticeTitle", label: "Анхааруулгын гарчиг", value: "НЭВТРЭХ ЭРХИЙН АНХААРУУЛГА", max: 40 },
  {
    side: "back",
    key: "notice",
    label: "Анхааруулгын текст",
    value: "Энэхүү карт нь Umbrella корпорацийн өмч бөгөөд байгууллагын нутаг дэвсгэрт байх бүх хугацаанд харагдахуйц зүүнэ. Бусдад шилжүүлэхийг хориглох ба шаардсан үед буцааж өгнө. Зөвшөөрөлгүй ашиглах, хуулбарлах, өөрчлөх тохиолдолд нэн даруй ажлаас халж, хуулийн хариуцлага хүлээлгэнэ.",
    max: 420,
    long: true,
  },
  { side: "back", key: "signLabel", label: "Гарын үсгийн шошго", value: "ЭРХ БҮХИЙ ГАРЫН ҮСЭГ", max: 32 },
  { side: "back", key: "qrLabel", label: "QR шошго", value: "ИРЦ БҮРТГЭЛ", max: 20 },
  { side: "back", key: "cardNoLabel", label: "Картын дугаарын шошго", value: "КАРТЫН №", max: 16 },
  { side: "back", key: "issuedLabel", label: "Олгосон огнооны шошго", value: "ОЛГОСОН", max: 16 },
  { side: "back", key: "levelLabel", label: "Түвшний шошго", value: "ТҮВШИН", max: 16 },
  { side: "back", key: "backBand", label: "Улаан зурвас", value: "ХОРИОТОЙ БҮС · БИОЛОГИЙН АЮУЛЫН 4-Р ТҮВШИН", max: 60 },
  { side: "back", key: "returnText", label: "Буцаах бичиг", value: "ОЛСОН ТОХИОЛДОЛД UMBRELLA КОРПОРАЦИЙН АЛЬ Ч САЛБАРТ БУЦААЖ ӨГНӨ ҮҮ", max: 80 },
  { side: "back", key: "hotline", label: "Утасны бичиг", value: "ХАМГААЛАЛТЫН УТАС · 0-800-UMBRELLA", max: 48 },
];

const TEXT_DEFAULTS = Object.fromEntries(CARD_TEXTS.map((item) => [item.key, item.value]));

function mnDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? ""));
  return match ? `${match[3]}.${match[1]}.${match[2]}` : String(value ?? "");
}

export function cardName(user) {
  return String(user?.displayName || user?.username || "").toUpperCase();
}

export function idCard(user, { flipped = false } = {}) {
  const card = user.card || {};
  const name = cardName(user);
  const level = Number(card.clearance) || 1;
  const tier = Math.min(5, Math.max(1, level));
  const blocked = card.status && card.status !== "ACTIVE";
  const photo = user.photo ? `<img src="${esc(user.photo)}" alt="" />` : SILHOUETTE;
  const status = STATUS_MN[card.status] || card.status;
  const t = (key) => esc(card.texts?.[key] || TEXT_DEFAULTS[key]);
  const verify = user.cardQr || `UMBRELLA|${card.idNumber}|${user.username}|L${level}|${card.status}`;
  const created = user.createdAt ? new Date(user.createdAt) : new Date();
  const two = (value) => String(value).padStart(2, "0");
  const issuedText = card.issued ? mnDate(card.issued) : `${created.getFullYear()}.${two(created.getMonth() + 1)}.${two(created.getDate())}`;
  return `
    <div class="idcard lv-${tier}${flipped ? " is-flipped" : ""}" role="button" tabindex="0" data-action="flip-card" data-user="${esc(user.id)}" aria-pressed="${flipped}" aria-label="${esc(name)} — ID карт. Дарж нөгөө талыг харна.">
      <div class="idcard-inner">
        <div class="idc-face idc-front">
          <div class="idc-body"></div>
          <div class="idc-stripe"></div>
          <div class="idc-band"><span>${t("band")}</span></div>
          <p class="idc-brand">${t("brand")}</p>
          <p class="idc-sub">${t("sub")} <span>${t("subAccent")}</span></p>
          <img class="idc-logo" src="/umbrella-logo.png" alt="" />
          <div class="idc-photo">${photo}</div>
          <div class="idc-name"><span>${t("nameLabel")}</span><b>${esc(name)}</b></div>
          <ul class="idc-rows">
            <li><span>${t("classLabel")}</span> ${esc(card.classification)}</li>
            <li><span>${t("projectLabel")}</span> ${esc(card.project)}</li>
            <li><span>${t("idLabel")}</span> ${esc(card.idNumber)}</li>
            <li class="${blocked ? "is-blocked" : ""}"><span>${t("statusLabel")}</span> ${esc(status)}</li>
          </ul>
          <div class="idc-level">${t("level")} <b>${level}</b></div>
          <div class="idc-code">${barcode(card.idNumber)}<span>${esc(card.idNumber)}</span></div>
          <p class="idc-auth">${t("auth")}<span>${t("expiresLabel")} ${esc(mnDate(card.expires))} ${t("expiresSuffix")}</span></p>
          ${blocked ? `<span class="idc-stamp">${esc(status)}</span>` : ""}
          <div class="idc-grain"></div>
        </div>
        <div class="idc-face idc-back">
          <p class="idc-back-top">${t("backTop")} <span>·</span> ${t("backTopAccent")}</p>
          <div class="idc-mag"></div>
          <div class="idc-back-body"></div>
          <div class="idc-stripe idc-back-stripe"></div>
          <div class="idc-back-text">
            <h3>${t("noticeTitle")}</h3>
            <p>${t("notice")}</p>
          </div>
          <div class="idc-sign">
            <span class="idc-sign-label">${t("signLabel")}</span>
            <span class="idc-sign-name">${esc(card.signature || user.displayName || user.username)}</span>
          </div>
          <div class="idc-qr">${qrSvg(verify)}</div>
          <p class="idc-qr-label">${t("qrLabel")}</p>
          <div class="idc-meta">
            <p><span>${t("cardNoLabel")}</span>${esc(card.idNumber)}</p>
            <p><span>${t("issuedLabel")}</span>${esc(issuedText)}</p>
            <p><span>${t("levelLabel")}</span>${level} / 5</p>
          </div>
          <div class="idc-holo"><img src="/umbrella-logo.png" alt="" /></div>
          <div class="idc-band idc-back-band"><span>${t("backBand")}</span></div>
          <p class="idc-return">${t("returnText")}<span>${t("hotline")}</span></p>
          <div class="idc-grain"></div>
        </div>
      </div>
    </div>`;
}
