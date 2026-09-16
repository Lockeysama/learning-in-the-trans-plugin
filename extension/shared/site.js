export function isSiteEnabled(host, disabledHosts = []) {
  if (!host) return true;
  return !disabledHosts.includes(host);
}

export function isAutoLearnHost(host, autoLearnHosts = [], disabledHosts = []) {
  if (!host) return false;
  if (!isSiteEnabled(host, disabledHosts)) return false;
  return autoLearnHosts.includes(host);
}

export function pageHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function shouldAutoLearnPage({
  host,
  autoLearnHosts = [],
  disabledHosts = [],
  apiKeyPresent = false,
  onboardingDone = false,
} = {}) {
  if (!apiKeyPresent || !onboardingDone) return false;
  return isAutoLearnHost(host, autoLearnHosts, disabledHosts);
}

export function initialViewMode(opts = {}) {
  return shouldAutoLearnPage(opts) ? "learning" : "original";
}

export function eventFromWidget(event, host) {
  if (!event || !host) return false;
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.includes(host) || host.contains?.(event.target);
}
