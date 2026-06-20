/**
 * src/utils/apiClient.ts
 *
 * Centralised HTTP utility that injects a Bearer JWT into every request and
 * handles automatic 401 retry after re-authentication.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4
 */

/**
 * Build a Headers object that merges any existing headers from `options` with
 * an optional Authorization header.
 */
function buildHeaders(
  existingHeaders: HeadersInit | undefined,
  jwt: string | null,
): HeadersInit {
  // Normalise whatever HeadersInit shape was passed in to a plain object.
  let merged: Record<string, string> = {};

  if (existingHeaders) {
    if (existingHeaders instanceof Headers) {
      existingHeaders.forEach((value, key) => {
        merged[key] = value;
      });
    } else if (Array.isArray(existingHeaders)) {
      for (const [key, value] of existingHeaders) {
        merged[key] = value;
      }
    } else {
      merged = { ...(existingHeaders as Record<string, string>) };
    }
  }

  // Inject Bearer token only when a non-null JWT is available (Req 6.1).
  if (jwt !== null) {
    merged['Authorization'] = `Bearer ${jwt}`;
  }

  return merged;
}

/**
 * Perform an authenticated HTTP request.
 *
 * 1. Reads the current JWT via `getJwt()`. If non-null, injects
 *    `Authorization: Bearer <jwt>` into the request headers (merged with any
 *    headers already present in `options`). (Req 6.1)
 * 2. Executes `fetch(url, mergedOptions)`.
 * 3. If the response status is 401:
 *    - Calls `onUnauthorized()` exactly once (Req 6.4)
 *    - Re-reads the JWT via `getJwt()` (may be a fresh token after re-auth)
 *    - Retries the request exactly once with the new JWT injected
 *    - Returns the second response regardless of its status — no further retry
 * 4. For all non-401 first-attempt responses, returns immediately.
 * 5. When JWT is null, no Authorization header is included. (Req 6.1)
 */
export async function apiRequest(
  url: string,
  options: RequestInit,
  getJwt: () => string | null,
  onUnauthorized: () => Promise<void>,
): Promise<Response> {
  // --- First attempt ---
  const firstJwt = getJwt();
  const firstOptions: RequestInit = {
    ...options,
    headers: buildHeaders(options.headers, firstJwt),
  };

  const firstResponse = await fetch(url, firstOptions);

  // Non-401: return immediately (Req 6.4 — no second attempt).
  if (firstResponse.status !== 401) {
    return firstResponse;
  }

  // --- 401 handling (Req 6.2, 6.4) ---
  // Call onUnauthorized exactly once.
  await onUnauthorized();

  // Re-read JWT (may have changed after re-auth).
  const retryJwt = getJwt();
  const retryOptions: RequestInit = {
    ...options,
    headers: buildHeaders(options.headers, retryJwt),
  };

  // Retry exactly once — return whatever comes back, do NOT retry again.
  const retryResponse = await fetch(url, retryOptions);
  return retryResponse;
}
