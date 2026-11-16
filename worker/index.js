/**
 * DumprX GitHub Pages -> GitHub Actions Dispatch Relay (Cloudflare Worker)
 *
 * Required secret:
 *   npx wrangler secret put GH_TOKEN   (fine-grained PAT with Actions: Read and write on this repo)
 *
 * Optional secret:
 *   npx wrangler secret put ACCESS_PIN (if set, users must enter this PIN on GitHub Pages)
 */

function corsHeaders(origin, allowedOrigin) {
  const allow = !allowedOrigin || allowedOrigin === "*" ? "*" : (origin === allowedOrigin ? origin : allowedOrigin);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

function isValidFirmwareUrl(raw) {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048 || /\s/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return ["http:", "https:", "ftp:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN || "*");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, headers);
    }

    if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== "*" && origin && origin !== env.ALLOWED_ORIGIN) {
      return jsonResponse({ ok: false, error: "Origin not allowed" }, 403, headers);
    }

    if (!env.GH_TOKEN) {
      return jsonResponse({ ok: false, error: "Worker misconfigured: GH_TOKEN secret missing" }, 500, headers);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400, headers);
    }

    if (env.ACCESS_PIN && String(payload.pin || "") !== String(env.ACCESS_PIN)) {
      return jsonResponse({ ok: false, error: "Invalid access PIN" }, 401, headers);
    }

    const firmwareUrl = typeof payload.firmware_url === "string" ? payload.firmware_url.trim() : "";
    if (!isValidFirmwareUrl(firmwareUrl)) {
      return jsonResponse(
        { ok: false, error: "Invalid firmware_url; must be a valid http(s):// or ftp:// URL" },
        400,
        headers
      );
    }

    const target = payload.target === "gitlab" ? "gitlab" : "github";
    const visibility = payload.visibility === "private" ? "private" : "public";
    const requestedBy = typeof payload.requested_by === "string"
      ? payload.requested_by.replace(/[\r\n]+/g, " ").trim().slice(0, 64)
      : "";

    const owner = env.GH_OWNER || "naden01";
    const repo = env.GH_REPO || "DumprX";
    const workflow = env.GH_WORKFLOW || "dump.yml";
    const ref = env.GH_REF || "main";

    const ghEndpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

    const ghRes = await fetch(ghEndpoint, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${env.GH_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "DumprX-Relay-Worker"
      },
      body: JSON.stringify({
        ref,
        inputs: {
          firmware_url: firmwareUrl,
          target,
          visibility,
          requested_by: requestedBy
        }
      })
    });

    if (!ghRes.ok) {
      const errJson = await ghRes.json().catch(() => ({}));
      return jsonResponse(
        {
          ok: false,
          error: errJson.message || `GitHub Actions dispatch failed (HTTP ${ghRes.status})`
        },
        ghRes.status >= 400 && ghRes.status < 500 ? ghRes.status : 502,
        headers
      );
    }

    return jsonResponse(
      {
        ok: true,
        message: "Workflow dispatched",
        runs_url: `https://github.com/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflow)}`
      },
      200,
      headers
    );
  }
};
