// Install retained routes as one logical unit. A subscriber may replay during
// setup, so callbacks wait until all siblings have committed; on failure, the
// last known-good routes remain in the desired roster for this sync pass.
export const installT3amsSubscriptionRouteSet = ({
  routes,
  desired,
  cap,
  install,
  isActive,
  reconcile,
  flush,
} = {}) => {
  const unique = [];
  const seen = new Set();
  for (const route of routes ?? []) {
    if (route == null || typeof route.id !== "string" || seen.has(route.id)) continue;
    seen.add(route.id);
    if (!desired.has(route.id)) unique.push(route);
  }
  if (desired.size + unique.length > cap) return { ok: false, omitted: unique.length };

  const staged = [];
  let committed = false;
  for (const route of unique) {
    const stagedRoute = { id: route.id, callback: route.callback, buffered: [], installed: null };
    const installed = install(route, (...args) => {
      if (committed) return route.callback(...args);
      stagedRoute.buffered.push(args);
      return undefined;
    });
    if (!installed?.ok) {
      for (const prior of staged) {
        prior.installed?.discard?.();
        // An unchanged route, or a discarded deferred replacement, still has
        // its committed predecessor. Retain that predecessor through cleanup.
        if (isActive(prior.id)) desired.add(prior.id);
      }
      if (isActive(route.id)) desired.add(route.id);
      reconcile();
      return { ok: false, omitted: 0 };
    }
    stagedRoute.installed = installed.changed ? installed : null;
    staged.push(stagedRoute);
  }

  for (const stagedRoute of staged) stagedRoute.installed?.commit?.();
  committed = true;
  for (const route of unique) desired.add(route.id);
  for (const stagedRoute of staged) {
    for (const args of stagedRoute.buffered.splice(0)) flush(stagedRoute, args);
  }
  return { ok: true, omitted: 0 };
};
