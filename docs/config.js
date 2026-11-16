// DumprX GitHub Pages configuration.
// Owner: set `relayUrl` after deploying `worker/` so users ONLY need to enter a firmware link.
window.DUMPRX_CONFIG = {
  // Set to "auto" to detect from <owner>.github.io/<repo>/, or hardcode explicitly:
  owner: "auto",
  repo: "auto",
  fallbackOwner: "naden01",
  fallbackRepo: "DumprX",
  workflow: "dump.yml",
  branch: "main",

  // Deployed Cloudflare Worker URL, e.g. "https://dumprx-relay.your-name.workers.dev"
  // Leave empty ("") to use Direct GitHub Token or GitHub Issue dispatch in the UI.
  relayUrl: "",

  // Default form selections
  defaultTarget: "gitlab", // "gitlab" or "github"
  defaultVisibility: "public", // "public" or "private"

  // Optional: Telegram group link shown in the UI so users know where dump links arrive
  telegramGroupUrl: "",
  telegramGroupLabel: "Telegram Group"
};
