# Implementation Plan: Wallet Signature Authentication (SIWE-style)

## Overview

This plan implements the full SIWE-style wallet authentication system across both the Spring Boot server and the React Native / Expo 51 client. Server tasks cover the `auth_nonces` schema, `AuthService`, `AuthController`, `AuthFilter`, `RateLimitService`, and `NonceCleaner`. Client tasks cover `apiClient`, the expanded `useWalletAuth` hook, and the `TwoStepConnectModal`. Existing hooks (`useFollowing`, `usePushNotifications`) are updated to use the centralised API client.

## Tasks

- [X] 1. Add dependencies and schema

  - [x] 1.1 Add jjwt and web3j dependencies to `pom.xml`
    - Add `jjwt-api:0.12.6`, `jjwt-impl:0.12.6` (runtime), `jjwt-jackson:0.12.6` (runtime) under `io.jsonwebtoken`
    - Add `org.web3j:core:4.10.3`
    - _Requirements: 4.7, 2.3_

  - [X] 1.2 Add `ethers@6.13.4` to client `package.json`
    - Run `npm install ethers@6.13.4`
    - _Requirements: 3.7_

  - [X] 1.3 Add `auth_nonces` table DDL to `schema.sql`
    - Add `CREATE TABLE IF NOT EXISTS auth_nonces (id SERIAL PRIMARY KEY, wallet_address TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT FALSE)`
    - Add index `idx_auth_nonces_address ON auth_nonces (wallet_address, used, expires_at)`
    - _Requirements: 8.1, 8.3_

  - [X] 1.4 Add `auth.jwt.secret` property to `application.properties`
    - Add `auth.jwt.secret=${JWT_SECRET}` — no hardcoded fallback
    - _Requirements: 4.7_

- [x] 2. Implement server-side Java DTOs and interfaces

  - [x] 2.1 Create Java record DTOs and `AuthService` interface
    - Create `NonceResponse(String nonce, String expiresAt)`, `VerifyRequest(String address, String signature)`, `TokenResponse(String token)`, `ErrorResponse(String error)` records in the `com.edgemarket` package
    - Create `AuthService` interface with `issueNonce(String walletAddress)` and `verifyAndIssue(String walletAddress, String signature)` methods
    - _Requirements: 1.1, 4.1, 4.2_

- [x] 3. Implement `RateLimitService`

  - [x] 3.1 Implement `RateLimitService` with sliding-window rate limiting
    - Use `ConcurrentHashMap<String, Deque<Long>>` keyed by `walletAddress`
    - Evict entries older than 60 seconds; reject (return `false`) when count ≥ 5
    - Expose `boolean allow(String walletAddress)` method
    - _Requirements: 10.1_

  - [ ]* 3.2 Write property test for rate limit enforcement (Property 16)
    - **Property 16: Rate Limiting Enforcement**
    - **Validates: Requirements 10.1**
    - For any wallet address, exactly 6 calls within a 60-second window: first 5 return `true`, 6th returns `false`
    - Use jqwik `@Property` with `@ForAll` wallet address strings

- [x] 4. Implement `AuthService` — nonce issuance

  - [x] 4.1 Implement `AuthService.issueNonce()`
    - Generate a `SecureRandom` 32 lowercase hex-char nonce
    - Insert row into `auth_nonces` via `JdbcTemplate` with `expires_at = NOW() + interval '5 minutes'`
    - Return `NonceResponse(nonce, expiresAt.toString())`
    - _Requirements: 1.1, 1.2, 8.1, 8.2_

  - [ ]* 4.2 Write property test for nonce format and persistence (Property 1)
    - **Property 1: Nonce Format and Persistence Invariant**
    - **Validates: Requirements 1.1, 1.2**
    - For any valid Ethereum address (regex-constrained via `@ForAll`), assert nonce is exactly 32 lowercase hex chars and `expiresAt` is within ±5 seconds of `NOW() + 5 minutes`

- [x] 5. Implement `AuthService` — signature verification and JWT issuance

  - [x] 5.1 Implement `AuthService.verifyAndIssue()`
    - Look up the most recent unused, unexpired nonce for `walletAddress`
    - Construct Challenge_Message: `"Sign in to EdgeMarket\nAddress: {addr}\nNonce: {nonce}"`
    - Call `web3j Sign.getAddressFromPersonalSign(message, signature)` to recover signer
    - Compare recovered address to `walletAddress` (lowercase, case-insensitive)
    - On match: mark nonce `used=TRUE` in the same transaction; issue JWT via jjwt (`sub`=lowercase address, `iat`=now, `exp`=now+86400); return `TokenResponse(token)`
    - On mismatch: throw `SignatureVerificationException`; on expired/used nonce: throw `NonceExpiredException`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 2.1, 2.3, 8.2_

  - [ ]* 5.2 Write property test for nonce single-use (Property 2)
    - **Property 2: Nonce Single-Use Invariant**
    - **Validates: Requirements 1.3, 8.2**
    - Submitting `verifyAndIssue` a second time with the same nonce always returns an error, even when the signature is valid

  - [ ]* 5.3 Write property test for expired nonce rejection (Property 3)
    - **Property 3: Expired Nonce Rejection**
    - **Validates: Requirements 1.4, 4.5**
    - For any address with a past-dated nonce, `verifyAndIssue` always returns an error indicating the nonce is expired

  - [ ]* 5.4 Write property test for sign-verify round trip (Property 7)
    - **Property 7: Sign-Verify Round Trip**
    - **Validates: Requirements 2.3, 3.5, 3.7, 4.1**
    - For any valid 32-byte hex private key, signing the Challenge_Message with ethers and recovering with web3j always returns the matching address (case-insensitive)

  - [ ]* 5.5 Write property test for JWT claims structure (Property 8)
    - **Property 8: JWT Claims Structure**
    - **Validates: Requirements 4.2, 4.3, 10.2**
    - For any valid address/signature pair, the returned JWT has `sub` equal to lowercase address, `exp` equal to exactly `iat + 86400`, and is verifiable with `JWT_SECRET`

  - [ ]* 5.6 Write property test for signature mismatch rejection (Property 9)
    - **Property 9: Signature Mismatch Rejection**
    - **Validates: Requirements 4.4**
    - For any signature not produced by the private key corresponding to the claimed address, `verifyAndIssue` always returns HTTP 401

  - [ ]* 5.7 Write property test for challenge message consistency (Property 5)
    - **Property 5: Challenge Message Construction Consistency**
    - **Validates: Requirements 2.1, 2.2**
    - For any address `addr` and nonce `n`, the server-side construction always produces `"Sign in to EdgeMarket\nAddress: " + addr.toLowerCase() + "\nNonce: " + n`

- [x] 6. Implement `NonceCleaner`

  - [x] 6.1 Implement `NonceCleaner` scheduled cleanup
    - Create `@Component NonceCleaner` with `@Scheduled(fixedDelay = 600_000)` method
    - Execute `DELETE FROM auth_nonces WHERE expires_at < NOW()`
    - _Requirements: 8.4_

- [x] 7. Implement `AuthController`

  - [x] 7.1 Implement `GET /api/auth/nonce` endpoint
    - Validate `address` query param against `^0x[0-9a-fA-F]{40}$`; return 400 `{ "error": "Invalid wallet address" }` on failure
    - Check rate limit via `RateLimitService.allow(address)`; return 429 `{ "error": "Too many requests" }` on excess
    - Delegate to `AuthService.issueNonce(address)` and return 200 with `NonceResponse`
    - _Requirements: 1.1, 1.5, 10.1_

  - [ ]* 7.2 Write property test for address format validation (Property 4)
    - **Property 4: Address Format Validation**
    - **Validates: Requirements 1.5**
    - For any string not matching `^0x[0-9a-fA-F]{40}$`, the nonce endpoint always returns HTTP 400 with `{ "error": "Invalid wallet address" }`

  - [x] 7.3 Implement `POST /api/auth/verify` endpoint
    - Enforce `Content-Type: application/json`; return 415 otherwise
    - Validate `address` and `signature` fields present; return 400 `{ "error": "address and signature are required" }` if missing
    - Delegate to `AuthService.verifyAndIssue(address, signature)`
    - Map `SignatureVerificationException` → 401, `NonceExpiredException` → 401, success → 200 `TokenResponse`
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 10.4_

  - [ ]* 7.4 Write property test for content-type enforcement (Property 17)
    - **Property 17: Content-Type Enforcement on Verify**
    - **Validates: Requirements 10.4**
    - Any request to `POST /api/auth/verify` with a non-`application/json` Content-Type always returns HTTP 415

- [x] 8. Implement `AuthFilter`

  - [x] 8.1 Implement `AuthFilter` (`OncePerRequestFilter`)
    - Apply only to `POST /api/follows`, `DELETE /api/follows`, `POST /api/push-tokens`, `DELETE /api/push-tokens`
    - Extract `Authorization: Bearer <token>` header; return 401 `{ "error": "Unauthorized" }` if absent/malformed/expired/wrong-secret
    - On valid JWT: store `sub` in `HttpServletRequest` attribute `"authenticatedAddress"`; proceed
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [ ]* 8.2 Write property test for Auth Filter token validation (Property 14)
    - **Property 14: Auth Filter Token Validation**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
    - Valid unexpired JWT signed with `JWT_SECRET` → request passes through; all other token values → 401 returned before controller; `sub` ≠ request `userAddress` → 403

  - [ ]* 8.3 Write property test for read endpoints unaffected (Property 15)
    - **Property 15: Read Endpoints Unaffected by Auth Filter**
    - **Validates: Requirements 7.5, 7.6**
    - Requests to read endpoints without `Authorization` header are never returned 401 by the Auth Filter

- [x] 9. Update `FollowsController` and `PushTokensController` for JWT sub-matching

  - [x] 9.1 Update `FollowsController` to read `authenticatedAddress` from request and enforce sub-match
    - Read `(String) request.getAttribute("authenticatedAddress")`
    - Compare (case-insensitive) to `userAddress` in the request body; return 403 `{ "error": "Forbidden: token subject does not match request address" }` on mismatch
    - _Requirements: 7.4_

  - [x] 9.2 Update `PushTokensController` to read `authenticatedAddress` and enforce sub-match
    - Same sub-match pattern as `FollowsController`
    - _Requirements: 7.4_

- [x] 10. Checkpoint — server side
  - Ensure all server tests pass, `schema.sql` creates `auth_nonces` successfully, and Protected_Endpoints return 401 without a valid JWT. Ask the user if questions arise.

- [x] 11. Implement `apiClient` utility (client)

  - [x] 11.1 Create `src/utils/apiClient.ts`
    - Implement `apiRequest(url, options, getJwt, onUnauthorized)` function
    - Inject `Authorization: Bearer <jwt>` header when JWT is non-null
    - On 401 response: call `onUnauthorized()` exactly once, then retry the request once with the new JWT
    - Never retry a third time regardless of the second response
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 11.2 Write property test for Bearer token injection (Property 12)
    - **Property 12: Bearer Token Injection**
    - **Validates: Requirements 6.1**
    - For any non-null JWT string and any URL, `apiRequest()` always includes `Authorization: Bearer <t>` in the outgoing request; when JWT is null, the header is absent

  - [ ]* 11.3 Write property test for 401 triggers clear and single retry (Property 13)
    - **Property 13: 401 Response Triggers JWT Clear and Single Retry**
    - **Validates: Requirements 5.5, 6.2, 6.4, 10.5**
    - For any Protected_Endpoint request receiving HTTP 401, `apiRequest()` invokes `onUnauthorized()` exactly once, retries exactly once with fresh JWT, and does not retry a third time

- [x] 12. Expand `useWalletAuth` hook

  - [x] 12.1 Add `jwt`, `authStatus`, `authenticate()`, and `clearAuth()` to `useWalletAuth`
    - Add new AsyncStorage key `@edgemarket/jwt`
    - Add `AuthStatus` type: `'unauthenticated' | 'authenticating' | 'authenticated' | 'error'`
    - Implement `authenticate()`: calls `GET /api/auth/nonce`, presents Step 2 modal for signing, calls `POST /api/auth/verify`, stores JWT
    - Implement `clearAuth()`: removes `@edgemarket/jwt` from AsyncStorage, clears `jwt` state, sets `authStatus` to `'unauthenticated'`
    - On `disconnect()`: also call `clearAuth()` to wipe both wallet and JWT state
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [x] 12.2 Implement startup JWT rehydration in `useWalletAuth`
    - On mount, load both `@edgemarket/wallet` and `@edgemarket/jwt` from AsyncStorage
    - Decode JWT `exp`; if valid, set `authStatus` to `'authenticated'` and schedule proactive refresh
    - If JWT is absent or expired, set `authStatus` to `'unauthenticated'`
    - _Requirements: 5.2, 5.4_

  - [x] 12.3 Implement proactive JWT refresh timer in `useWalletAuth`
    - In a `useEffect`, set a `setTimeout` for `(exp - iat - 60) * 1000` ms when `authStatus === 'authenticated'`
    - On timer fire, call `authenticate()` silently using stored `walletAddress`
    - Clear the timer on `disconnect()` or `clearAuth()`
    - _Requirements: 5.4_

  - [ ]* 12.4 Write property test for JWT storage and rehydration round trip (Property 10)
    - **Property 10: JWT Storage and Rehydration Round Trip**
    - **Validates: Requirements 5.1, 5.2**
    - For any JWT string `t`, storing via the hook and re-initialising always results in `jwt === t` with no mutation

  - [ ]* 12.5 Write property test for disconnect clears all auth state (Property 11)
    - **Property 11: Disconnect Clears All Auth State**
    - **Validates: Requirements 5.3**
    - For any connected/authenticated state, `disconnect()` always results in `walletAddress === null`, `jwt === null`, `authStatus === 'unauthenticated'`, and no AsyncStorage entries for either key

- [x] 13. Implement private key validator (client)

  - [x] 13.1 Create `src/utils/privateKeyValidator.ts`
    - Export `isValidPrivateKey(input: string): boolean` — accepts exactly 64 hex chars optionally preceded by `0x`; rejects all other strings
    - _Requirements: 3.3, 3.4_

  - [ ]* 13.2 Write property test for private key validation (Property 6)
    - **Property 6: Private Key Validation**
    - **Validates: Requirements 3.3, 3.4**
    - For any input string, the validator accepts it if and only if it is exactly 64 hex chars (optionally `0x`-prefixed); rejects strings differing by a single character, containing whitespace, or having wrong length

  - [ ]* 13.3 Write property test for challenge message consistency on client (Property 5 — client side)
    - **Property 5: Challenge Message Construction Consistency (client)**
    - **Validates: Requirements 2.1, 2.2**
    - For any `addr` and nonce `n`, the client-side message builder always produces the identical string as the server-side builder

- [x] 14. Implement `TwoStepConnectModal`

  - [x] 14.1 Create `src/components/TwoStepConnectModal.tsx` — Step 1 (address entry)
    - `TextInput` for wallet address (existing behaviour preserved)
    - On "Next": validate `^0x[0-9a-fA-F]{40}$`; call `GET /api/auth/nonce` via `apiClient`
    - On nonce success: advance to Step 2
    - On nonce failure: display "Unable to reach server — check your connection"; remain on Step 1
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 14.2 Implement Step 2 (private key entry and signing) in `TwoStepConnectModal`
    - Display truncated wallet address for confirmation
    - `TextInput` with `secureTextEntry={true}` for private key input
    - Validate input via `isValidPrivateKey()`; show "Invalid private key — must be a 64-character hex string" on failure
    - Derive address from private key using `ethers.Wallet`; compare (case-insensitive) to stored wallet address
    - If mismatch: show "Private key does not match connected wallet address"; retain key in input
    - On match: sign Challenge_Message via `ethers.Wallet.signMessage()`, immediately call `setPrivateKey('')` after sign
    - Call `POST /api/auth/verify`; on success: call `connect(address)` + store JWT; dismiss modal
    - Never persist private key to AsyncStorage, logs, or remote service
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 9.4_

  - [x] 14.3 Implement re-auth path (Step 2 only) in `ProfileScreen`
    - When `isConnected === true` and JWT is expired or absent: present `TwoStepConnectModal` starting at Step 2 using stored `walletAddress`
    - When `isConnected === false`: present modal starting at Step 1
    - Display "Authentication required — please sign in again" when server returns 401/403 from Protected_Endpoint
    - _Requirements: 9.5, 9.6, 10.5_

  - [ ]* 14.4 Write property test for two-step modal step progression (Property 18)
    - **Property 18: Two-Step Modal Step Progression**
    - **Validates: Requirements 9.1, 9.2**
    - For any valid wallet address entered in Step 1, the modal always makes a nonce API request before advancing to Step 2; it is impossible to reach Step 2 without a successful nonce fetch

  - [ ]* 14.5 Write property test for re-auth Step 2 only when connected (Property 19)
    - **Property 19: Re-Auth Step 2 Only When Connected**
    - **Validates: Requirements 9.5, 9.6**
    - When `isConnected === true` and JWT is expired, modal always starts at Step 2; when `isConnected === false`, modal always starts at Step 1

- [x] 15. Update `useFollowing` and `usePushNotifications` to use `apiClient`

  - [x] 15.1 Replace raw `fetch()` calls in `useFollowing` with `apiClient.apiRequest()`
    - Import `apiRequest` from `src/utils/apiClient.ts`
    - Pass `getJwt` from `useWalletAuth` and `onUnauthorized` (calls `clearAuth()` + surfaces re-auth prompt)
    - _Requirements: 6.1, 6.3_

  - [x] 15.2 Replace raw `fetch()` calls in `usePushNotifications` with `apiClient.apiRequest()`
    - Same pattern as `useFollowing`
    - _Requirements: 6.1, 6.3_

- [x] 16. Final checkpoint — Ensure all tests pass
  - All property-based and unit tests pass on both server and client. All Protected_Endpoints reject requests without a valid JWT. The two-step modal completes the full nonce→sign→verify flow. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests (jqwik on server, fast-check on client) validate universal correctness properties with a minimum of 100 iterations each
- Unit tests validate specific examples and error paths not covered by property tests
- The private key is never stored, logged, or transmitted — it is cleared from state immediately after `signMessage()` resolves or rejects

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "3.1"] },
    { "id": 2, "tasks": ["3.2", "4.1", "13.1"] },
    { "id": 3, "tasks": ["4.2", "5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "6.1"] },
    { "id": 5, "tasks": ["7.1", "7.3", "11.1"] },
    { "id": 6, "tasks": ["7.2", "7.4", "8.1", "11.2", "11.3", "12.1", "13.2", "13.3"] },
    { "id": 7, "tasks": ["8.2", "8.3", "9.1", "9.2", "12.2"] },
    { "id": 8, "tasks": ["12.3", "14.1"] },
    { "id": 9, "tasks": ["12.4", "12.5", "14.2"] },
    { "id": 10, "tasks": ["14.3", "15.1", "15.2"] },
    { "id": 11, "tasks": ["14.4", "14.5"] }
  ]
}
```
