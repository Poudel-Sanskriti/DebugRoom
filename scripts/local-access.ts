import { loadConfig } from "../apps/api/src/config.ts";
const config = await loadConfig();
if (!config.localAuth || !config.localLoginToken)
  throw new Error("Local access is disabled in hosted mode");
// This command deliberately displays a local sign-in capability; do not put it in routine logs.
console.log(`${config.origin}/#local=${config.localLoginToken}`);
