// Public HTTPS address for the UMBRELLA phone app through a Cloudflare tunnel to this localhost server.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const METRICS_PORT = Number(process.env.TUNNEL_METRICS_PORT) || 4180;
const CANDIDATES = [
  process.env.CLOUDFLARED_PATH,
  path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "cloudflared", "cloudflared.exe"),
  path.join(process.env.ProgramFiles || "C:\\Program Files", "cloudflared", "cloudflared.exe"),
  path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Links", "cloudflared.exe"),
].filter(Boolean);

/** On a hosting platform (Render) the server is public by itself: no tunnel and no Wi-Fi station port. */
export const HOSTED = Boolean(process.env.RENDER || process.env.HOSTED === "1");

let current = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "") || null;

export function publicUrl() {
  return current;
}

/** True for requests from the internet (through the tunnel, or any request when hosted) rather than from this computer. */
export function tunneled(req) {
  return HOSTED || Boolean(req.headers["cf-connecting-ip"] || req.headers["cf-ray"]);
}

async function quickHost() {
  try {
    const res = await fetch(`http://127.0.0.1:${METRICS_PORT}/quicktunnel`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.hostname ? `https://${data.hostname}` : null;
  } catch {
    return null;
  }
}

function binary() {
  return CANDIDATES.find((file) => existsSync(file)) || "cloudflared";
}

/**
 * Keeps one cloudflared running beside the server. It is started detached so a server restart keeps the same
 * address; a quick tunnel (no Cloudflare account) gets a new trycloudflare.com address only when cloudflared
 * itself restarts. With CLOUDFLARE_TUNNEL_TOKEN and PUBLIC_URL a named tunnel keeps a fixed address.
 */
export async function ensureTunnel(port, log = console.log) {
  if (HOSTED) {
    if (current) log(`UMBRELLA (интернэт): ${current}`);
    return current;
  }
  if (process.env.PUBLIC_TUNNEL === "off") return null;
  const token = process.env.CLOUDFLARE_TUNNEL_TOKEN;
  const found = await quickHost();
  if (found || (token && (await metricsUp()))) {
    current = process.env.PUBLIC_URL?.replace(/\/+$/, "") || found;
    if (current) log(`UMBRELLA апп (интернэт): ${current}`);
    return current;
  }
  const args = ["tunnel", "--no-autoupdate", "--metrics", `127.0.0.1:${METRICS_PORT}`];
  if (token) args.push("run", "--token", token);
  else args.push("--url", `http://127.0.0.1:${port}`);
  try {
    const child = spawn(binary(), args, { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (error) => log(`Cloudflare туннель ажиллахгүй: ${error.message}`));
    child.unref();
  } catch (error) {
    log(`Cloudflare туннель ажиллахгүй: ${error.message}`);
    return null;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if (token) {
      if (await metricsUp()) break;
      continue;
    }
    const host = await quickHost();
    if (host) {
      current = host;
      break;
    }
  }
  if (token) current = process.env.PUBLIC_URL?.replace(/\/+$/, "") || null;
  log(current ? `UMBRELLA апп (интернэт): ${current}` : "Cloudflare туннелийн хаяг гарсангүй.");
  return current;
}

async function metricsUp() {
  try {
    const res = await fetch(`http://127.0.0.1:${METRICS_PORT}/ready`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}
