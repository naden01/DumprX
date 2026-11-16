(function () {
  "use strict";

  const cfg = window.DUMPRX_CONFIG || {};
  const STORAGE_PAT = "dumprx_gh_pat";
  const STORAGE_RELAY = "dumprx_relay_url";

  function detectRepo() {
    let owner = cfg.owner && cfg.owner !== "auto" ? cfg.owner : "";
    let repo = cfg.repo && cfg.repo !== "auto" ? cfg.repo : "";

    const host = window.location.hostname || "";
    const parts = window.location.pathname.split("/").filter(Boolean);

    if (!owner && host.endsWith(".github.io")) {
      owner = host.slice(0, -".github.io".length);
    }
    if (!repo && host.endsWith(".github.io") && parts.length > 0) {
      repo = parts[0];
    }

    return {
      owner: owner || cfg.fallbackOwner || "naden01",
      repo: repo || cfg.fallbackRepo || "DumprX",
      workflow: cfg.workflow || "dump.yml",
      branch: cfg.branch || "main"
    };
  }

  const repoInfo = detectRepo();

  const form = document.getElementById("dump-form");
  const urlInput = document.getElementById("firmware-url");
  const targetSelect = document.getElementById("target");
  const visibilitySelect = document.getElementById("visibility");
  const requestedByInput = document.getElementById("requested-by");
  const pinField = document.getElementById("pin-field");
  const pinInput = document.getElementById("access-pin");
  const directAuthBox = document.getElementById("direct-auth-box");
  const patInput = document.getElementById("gh-pat");
  const clearPatBtn = document.getElementById("clear-pat-btn");
  const customRelayInput = document.getElementById("custom-relay");
  const submitBtn = document.getElementById("submit-btn");
  const issueBtn = document.getElementById("issue-btn");
  const statusBox = document.getElementById("status-box");
  const runsList = document.getElementById("runs-list");
  const refreshRunsBtn = document.getElementById("refresh-runs-btn");
  const repoBadge = document.getElementById("repo-badge");
  const modeBadge = document.getElementById("mode-badge");
  const actionsLink = document.getElementById("actions-link");
  const tgBanner = document.getElementById("tg-banner");
  const tgLink = document.getElementById("tg-link");

  let pollTimer = null;

  function activeRelayUrl() {
    const queryRelay = new URLSearchParams(window.location.search).get("relay");
    if (queryRelay && /^https?:\/\//i.test(queryRelay.trim())) {
      localStorage.setItem(STORAGE_RELAY, queryRelay.trim());
    }
    return (
      (cfg.relayUrl || "").trim() ||
      (customRelayInput.value || "").trim() ||
      (localStorage.getItem(STORAGE_RELAY) || "").trim()
    );
  }

  function updateModeUI() {
    const relay = activeRelayUrl();
    const hasPat = Boolean((patInput.value || localStorage.getItem(STORAGE_PAT) || "").trim());

    if (relay) {
      modeBadge.textContent = "Link-only mode (Relay active)";
      modeBadge.className = "badge badge-ok";
      directAuthBox.classList.add("hidden");
      pinField.classList.remove("hidden");
    } else {
      modeBadge.textContent = hasPat ? "Direct PAT mode" : "Setup relay or enter PAT";
      modeBadge.className = hasPat ? "badge badge-ok" : "badge badge-warn";
      directAuthBox.classList.remove("hidden");
      pinField.classList.add("hidden");
    }
  }

  function init() {
    repoBadge.textContent = `${repoInfo.owner}/${repoInfo.repo}`;
    actionsLink.href = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(repoInfo.workflow)}`;

    if (cfg.defaultTarget) targetSelect.value = cfg.defaultTarget;
    if (cfg.defaultVisibility) visibilitySelect.value = cfg.defaultVisibility;

    if (cfg.telegramGroupUrl) {
      tgLink.href = cfg.telegramGroupUrl;
      tgLink.textContent = cfg.telegramGroupLabel || "Telegram Group";
      tgBanner.classList.remove("hidden");
    }

    const savedPat = localStorage.getItem(STORAGE_PAT) || "";
    if (savedPat) patInput.value = savedPat;

    const savedRelay = localStorage.getItem(STORAGE_RELAY) || "";
    if (savedRelay) customRelayInput.value = savedRelay;

    const queryUrl = new URLSearchParams(window.location.search).get("url");
    if (queryUrl) urlInput.value = queryUrl;

    updateModeUI();
    fetchRuns();
  }

  function setStatus(kind, message, linkUrl, linkLabel) {
    statusBox.className = `status-box ${kind}`;
    statusBox.textContent = "";
    const span = document.createElement("span");
    span.textContent = message;
    statusBox.appendChild(span);

    if (linkUrl) {
      statusBox.appendChild(document.createTextNode(" "));
      const a = document.createElement("a");
      a.href = linkUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = linkLabel || "Open";
      statusBox.appendChild(a);
    }
    statusBox.classList.remove("hidden");
  }

  function validateFirmwareUrl(raw) {
    const trimmed = (raw || "").trim();
    if (!trimmed) {
      return { ok: false, error: "Please enter a firmware download URL." };
    }
    if (/\s/.test(trimmed)) {
      return { ok: false, error: "Firmware URL must not contain spaces." };
    }
    try {
      const parsed = new URL(trimmed);
      if (!["http:", "https:", "ftp:"].includes(parsed.protocol)) {
        return { ok: false, error: "URL must start with https://, http://, or ftp://." };
      }
    } catch {
      return { ok: false, error: "Please enter a valid URL (including https://)." };
    }
    return { ok: true, url: trimmed };
  }

  async function triggerViaRelay(relayUrl, payload) {
    const res = await fetch(relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.message || `Relay error (HTTP ${res.status})`);
    }
    return data;
  }

  async function triggerViaGitHubPat(pat, payload) {
    const endpoint = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(repoInfo.workflow)}/dispatches`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${pat}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ref: repoInfo.branch,
        inputs: {
          firmware_url: payload.firmware_url,
          target: payload.target,
          visibility: payload.visibility,
          requested_by: payload.requested_by || ""
        }
      })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || `GitHub API returned HTTP ${res.status}`);
    }
    return {
      ok: true,
      runs_url: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(repoInfo.workflow)}`
    };
  }

  function openGitHubIssueFallback(payload) {
    const base = `https://github.com/${repoInfo.owner}/${repoInfo.repo}/issues/new`;
    const params = new URLSearchParams({
      template: "dump-firmware.yml",
      title: `[Dump] ${payload.firmware_url.slice(0, 60)}`,
      firmware_url: payload.firmware_url,
      target: payload.target,
      visibility: payload.visibility,
      requested_by: payload.requested_by || ""
    });
    window.open(`${base}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  function scheduleRunsPoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(fetchRuns, 10000);
  }

  async function fetchRuns() {
    clearTimeout(pollTimer);
    pollTimer = null;
    const endpoint = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(repoInfo.workflow)}/runs?per_page=8`;
    try {
      const headers = { "Accept": "application/vnd.github+json" };
      const pat = (patInput.value || localStorage.getItem(STORAGE_PAT) || "").trim();
      if (pat) headers["Authorization"] = `Bearer ${pat}`;

      const res = await fetch(endpoint, { headers });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const runs = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
      renderRuns(runs);

      if (runs.some((r) => r.status === "queued" || r.status === "in_progress")) {
        scheduleRunsPoll();
      }
    } catch (err) {
      runsList.textContent = "";
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = `Could not load workflow runs (${err.message}).`;
      runsList.appendChild(p);
    }
  }

  function renderRuns(runs) {
    runsList.textContent = "";
    if (runs.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No workflow runs found yet.";
      runsList.appendChild(p);
      return;
    }

    for (const run of runs) {
      const item = document.createElement("div");
      item.className = "run-item";

      const meta = document.createElement("div");
      meta.className = "run-meta";

      const pill = document.createElement("span");
      let pillClass = "run-neutral";
      let label = run.status || "unknown";
      if (run.status === "completed") {
        label = run.conclusion || "completed";
        if (run.conclusion === "success") pillClass = "run-success";
        else if (run.conclusion === "failure" || run.conclusion === "timed_out") pillClass = "run-failure";
      } else if (run.status === "in_progress" || run.status === "queued") {
        pillClass = "run-active";
      }
      pill.className = `run-pill ${pillClass}`;
      pill.textContent = label.replace("_", " ");

      const title = document.createElement("span");
      title.textContent = `#${run.run_number || run.id} · ${run.event}`;

      const time = document.createElement("span");
      time.className = "muted";
      time.textContent = run.created_at ? new Date(run.created_at).toLocaleString() : "";

      meta.append(pill, title, time);

      const link = document.createElement("a");
      link.className = "link-btn";
      link.href = run.html_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Logs ↗";

      item.append(meta, link);
      runsList.appendChild(item);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const check = validateFirmwareUrl(urlInput.value);
    if (!check.ok) {
      setStatus("err", check.error);
      urlInput.focus();
      return;
    }

    const payload = {
      firmware_url: check.url,
      target: targetSelect.value,
      visibility: visibilitySelect.value,
      requested_by: requestedByInput.value.trim(),
      pin: pinInput.value
    };

    const relay = activeRelayUrl();
    const pat = (patInput.value || "").trim();

    if (!relay && !pat) {
      setStatus(
        "err",
        "No relay URL configured and no GitHub PAT entered. Enter a PAT below, paste a Relay URL, or use 'Open as GitHub Issue'."
      );
      return;
    }

    submitBtn.disabled = true;
    setStatus("info", "Dispatching GitHub Actions dump workflow…");

    try {
      let result;
      if (relay) {
        if (customRelayInput.value.trim()) {
          localStorage.setItem(STORAGE_RELAY, customRelayInput.value.trim());
        }
        result = await triggerViaRelay(relay, payload);
      } else {
        localStorage.setItem(STORAGE_PAT, pat);
        result = await triggerViaGitHubPat(pat, payload);
      }

      setStatus(
        "ok",
        "Dump workflow triggered! Telegram will receive start status and the final dump link once complete.",
        result.runs_url || actionsLink.href,
        "Watch Actions Logs ↗"
      );
      urlInput.value = "";
      setTimeout(fetchRuns, 2500);
    } catch (err) {
      setStatus("err", `Failed to trigger workflow: ${err.message}`);
    } finally {
      submitBtn.disabled = false;
      updateModeUI();
    }
  });

  issueBtn.addEventListener("click", () => {
    const check = validateFirmwareUrl(urlInput.value);
    if (!check.ok) {
      setStatus("err", check.error);
      urlInput.focus();
      return;
    }
    openGitHubIssueFallback({
      firmware_url: check.url,
      target: targetSelect.value,
      visibility: visibilitySelect.value,
      requested_by: requestedByInput.value.trim()
    });
  });

  patInput.addEventListener("input", updateModeUI);
  customRelayInput.addEventListener("input", updateModeUI);

  clearPatBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_PAT);
    patInput.value = "";
    updateModeUI();
    setStatus("info", "Cleared saved GitHub PAT from browser storage.");
  });

  refreshRunsBtn.addEventListener("click", fetchRuns);

  init();
})();
