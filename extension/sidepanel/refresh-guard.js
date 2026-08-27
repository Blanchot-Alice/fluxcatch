/** Capture the tab generation owned by one asynchronous media refresh. */
export function captureMediaRefresh(state = {}) {
  return Object.freeze({
    tabId: Number.isInteger(state.tabId) ? state.tabId : null,
    refreshToken: Number(state.refreshToken) || 0
  });
}

/** Return false when tab activation or a newer full refresh made a response stale. */
export function isMediaRefreshCurrent(request, state = {}) {
  return Number.isInteger(request?.tabId)
    && request.tabId === state.tabId
    && request.refreshToken === state.refreshToken;
}
