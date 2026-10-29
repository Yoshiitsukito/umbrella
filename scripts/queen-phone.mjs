import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.PORT) || 4173;
const APP_ID = "mn.umbrella.white_queen";
const candidates = [
  process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, "platform-tools", "adb.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Android", "platform-tools", "adb.exe"),
].filter(Boolean);
const adbPath = candidates.find((file) => existsSync(file)) || "adb";

function adb(...args) {
  return execFileSync(adbPath, args, { encoding: "utf8" }).trim();
}

const devices = adb("devices")
  .split("\n")
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial]) => serial);

const ready = devices.filter(([, state]) => state === "device");
if (!ready.length) {
  const pending = devices.find(([, state]) => state === "unauthorized");
  console.error(
    pending
      ? "Утасны дэлгэц дээрх 'Allow USB debugging' цонхонд Allow дарна уу, дараа нь дахин ажиллуулна уу."
      : "Утас олдсонгүй. USB кабелиар холбож, Developer options → USB debugging-ийг асаана уу.",
  );
  process.exit(1);
}

for (const [serial] of ready) {
  adb("-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`);
  const model = adb("-s", serial, "shell", "getprop", "ro.product.model");
  console.log(`${model} (${serial}): утасны http://localhost:${port} → энэ компьютерын сервер`);
  if (!process.argv.includes("--open")) continue;
  if (adb("-s", serial, "shell", "pm", "list", "packages", "--user", "0", APP_ID).includes(APP_ID)) {
    adb("-s", serial, "shell", "am", "start", "--user", "0", "-n", `${APP_ID}/.MainActivity`);
    console.log("Утсан дээр White Queen апп нээгдлээ.");
  } else {
    adb("-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `http://localhost:${port}/queen`, "com.android.chrome");
    console.log("Утсан дээр Chrome-оор White Queen нээгдлээ.");
  }
}
