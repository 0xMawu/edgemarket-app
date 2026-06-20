# Requirements Document

## Introduction

This feature adds cryptographic wallet-ownership authentication to the EdgeMarket app.
Currently, all write endpoints (`POST /api/follows`, `DELETE /api/follows`, `POST /api/push-tokens`, `DELETE /api/push-tokens`) accept any wallet address with no proof of ownership, allowing any client to modify another user's data.

The solution is a standard SIWE-style (Sign-In With Ethereum) challenge-response flow: the app requests a one-time nonce from the server, the user signs a deterministic challenge message with their Ethereum private key (using a library that runs entirely on-device), and the server recovers the signer address from the signature to verify ownership before issuing a short-lived JWT. Subsequent write requests attach the JWT as a Bearer token. No WalletConnect dependency is required.

---

## Glossary

- **Auth_Service**: The Spring Boot component responsible for nonce issuance, signature verification, and JWT issuance/validation.
- **Auth_Client**: The React Native / Expo 51 module responsible for requesting nonces, invoking on-device signing, storing JWTs, and attaching them to API requests.
- **Wallet_Address**: A lowercase hexadecimal Ethereum address in the form `0x` followed by 40 hex characters.
- **Nonce**: A cryptographically random, single-use string issued by the Auth_Service to prevent replay attacks.
- **Challenge_Message**: A human-readable string constructed deterministically from the Nonce and Wallet_Address that the user signs. Format: `"Sign in to EdgeMarket\nAddress: {wallet_address}\nNonce: {nonce}"`.
- **Signature**: The ECDSA secp256k1 signature produced by signing the Challenge_Message with the private key corresponding to the Wallet_Address.
- **JWT**: A JSON Web Token (HS256) issued by the Auth_Service after successful signature verification, used to authorise subsequent write requests.
- **Protected_Endpoint**: Any write endpoint whose operation must be restricted to the authenticated wallet owner: `POST /api/follows`, `DELETE /api/follows`, `POST /api/push-tokens`, `DELETE /api/push-tokens`.
- **Signing_Library**: An on-device JavaScript/TypeScript library (e.g. `ethers` or `@ethersproject/wallet`) that can sign arbitrary messages using an Ethereum private key without requiring network access or WalletConnect.
- **Token_Store**: The React Native AsyncStorage namespace used to persist the JWT on-device between app sessions.
- **Auth_Filter**: The Spring Boot `OncePerRequestFilter` that validates Bearer JWTs on incoming requests to Protected_Endpoints.

---

## Requirements

### Requirement 1: Nonce Issuance

**User Story:** As a wallet owner, I want the server to give me a unique, time-limited challenge so that my sign-in cannot be replayed by an attacker who captures my signature.

#### Acceptance Criteria

1. WHEN a `GET /api/auth/nonce?address={wallet_address}` request is received, THE Auth_Service SHALL generate a cryptographically random nonce of at least 16 bytes (32 hex characters) and return it in the response body as `{ "nonce": "<value>", "expiresAt": "<ISO-8601 UTC timestamp>" }`.
2. WHEN a nonce is issued, THE Auth_Service SHALL associate the nonce with the requesting Wallet_Address and store it with a time-to-live of 5 minutes.
3. WHEN a nonce has been successfully used for authentication, THE Auth_Service SHALL invalidate it immediately so it cannot be reused.
4. WHEN a nonce reaches its 5-minute expiry without being used, THE Auth_Service SHALL treat it as invalid for all subsequent authentication attempts.
5. IF the `address` query parameter is absent or does not match the pattern `^0x[0-9a-fA-F]{40}$`, THEN THE Auth_Service SHALL return HTTP 400 with body `{ "error": "Invalid wallet address" }`.

---

### Requirement 2: Challenge Message Construction

**User Story:** As a developer, I want the challenge message format to be consistent and human-readable so that users can understand what they are signing and auditors can verify the format.

#### Acceptance Criteria

1. THE Auth_Service SHALL construct the Challenge_Message using the exact template: `"Sign in to EdgeMarket\nAddress: {wallet_address}\nNonce: {nonce}"` where `{wallet_address}` is the lowercase Wallet_Address and `{nonce}` is the issued nonce string.
2. WHEN the Auth_Client constructs a Challenge_Message, THE Auth_Client SHALL use the identical template `"Sign in to EdgeMarket\nAddress: {wallet_address}\nNonce: {nonce}"` before passing it to the Signing_Library.
3. WHEN a Challenge_Message is constructed, THE Auth_Service SHALL prefix it with the Ethereum personal-sign envelope `"\x19Ethereum Signed Message:\n{length}"` (where `{length}` is the byte length of the message) before recovering the signer address, matching the EIP-191 personal_sign standard.

---

### Requirement 3: On-Device Message Signing

**User Story:** As a wallet owner using manual address entry, I want to sign the challenge message on my device using my private key so that I can prove wallet ownership without WalletConnect.

#### Acceptance Criteria

1. WHEN the Auth_Client begins the sign-in flow, THE Auth_Client SHALL display a modal prompting the user for their Ethereum private key, separate from the existing wallet-address entry modal.
2. WHILE the private key entry modal is visible, THE Auth_Client SHALL render the input field with `secureTextEntry={true}` so the key value is masked.
3. WHEN the user submits a private key, THE Auth_Client SHALL validate that the private key is a 32-byte hex string (with or without `0x` prefix) before attempting to sign.
4. IF the private key is invalid, THEN THE Auth_Client SHALL display the error message "Invalid private key — must be a 64-character hex string" without sending any network request.
5. WHEN a valid private key is submitted, THE Auth_Client SHALL derive the public Ethereum address from the key using the Signing_Library and compare it (case-insensitive) to the stored Wallet_Address.
6. IF the derived address does not match the stored Wallet_Address, THEN THE Auth_Client SHALL display the error message "Private key does not match connected wallet address" and reject the sign-in attempt.
7. WHEN address derivation succeeds, THE Auth_Client SHALL use the Signing_Library to sign the Challenge_Message and immediately clear the private key state variable from memory after signing completes.
8. IF address derivation fails, THE Auth_Client SHALL retain the private key value in the input field so the user may correct and retry, without clearing the state variable.
9. THE Auth_Client SHALL NOT persist the private key to AsyncStorage, logs, or any remote service at any point during or after the signing process.

---

### Requirement 4: JWT Issuance

**User Story:** As a wallet owner, I want to receive a JWT after proving ownership so that I do not need to sign again on every write request.

#### Acceptance Criteria

1. WHEN a `POST /api/auth/verify` request is received with body `{ "address": "<wallet_address>", "signature": "<hex_signature>" }`, THE Auth_Service SHALL recover the signer address from the Signature using the EIP-191 personal_sign method.
2. WHEN the recovered signer address matches the stored Wallet_Address associated with the provided nonce (case-insensitive), THE Auth_Service SHALL issue a JWT signed with HS256 containing the claims `{ "sub": "<lowercase_wallet_address>", "iat": <unix_timestamp>, "exp": <unix_timestamp + 86400> }`.
3. WHEN the JWT is issued, THE Auth_Service SHALL return HTTP 200 with body `{ "token": "<jwt>" }`.
4. IF the recovered signer address does not match the Wallet_Address, THEN THE Auth_Service SHALL return HTTP 401 with body `{ "error": "Signature verification failed" }` and invalidate any nonce associated with the request.
5. IF the nonce provided in the request body is expired or already used, THEN THE Auth_Service SHALL return HTTP 401 with body `{ "error": "Nonce expired or already used" }`.
6. IF the request body is missing `address` or `signature`, THEN THE Auth_Service SHALL return HTTP 400 with body `{ "error": "address and signature are required" }`.
7. THE Auth_Service SHALL use a JWT signing secret of at least 256 bits, configured via an environment variable `JWT_SECRET`, and SHALL NOT fall back to a hardcoded default in production.

---

### Requirement 5: JWT Storage and Lifecycle (Client)

**User Story:** As a wallet owner, I want my session to persist across app restarts so that I do not need to sign again every time I open the app.

#### Acceptance Criteria

1. WHEN a JWT is successfully received from the Auth_Service, THE Auth_Client SHALL persist it to the Token_Store under the key `@edgemarket/jwt`.
2. WHEN the app initialises, THE Auth_Client SHALL rehydrate the JWT from the Token_Store alongside the Wallet_Address rehydration.
3. WHEN the user disconnects their wallet, THE Auth_Client SHALL remove the JWT from the Token_Store and clear it from memory.
4. WHEN a JWT is within 60 seconds of its `exp` claim, THE Auth_Client SHALL proactively re-authenticate by initiating a new nonce-request/sign/verify cycle using the stored Wallet_Address.
5. IF the JWT is absent, expired, or re-authentication is explicitly attempted and fails, THEN THE Auth_Client SHALL treat the user as unauthenticated; write operations SHALL be blocked at the API level and an authentication error SHALL be surfaced to the UI.
6. THE Auth_Client SHALL expose the JWT and authentication status through the existing `useWalletAuth` hook so that all screens consume a single source of truth.

---

### Requirement 6: Authenticated API Requests

**User Story:** As a wallet owner, I want all write requests to automatically include my JWT so that I do not need to manage authentication manually in each screen.

#### Acceptance Criteria

1. WHEN the Auth_Client makes a request to a Protected_Endpoint, THE Auth_Client SHALL include the header `Authorization: Bearer <jwt>`.
2. WHEN the JWT is absent or expired at the time of a write request, THE Auth_Client SHALL initiate re-authentication before retrying the request.
3. THE Auth_Client SHALL centralise Bearer token injection in a single HTTP utility function or wrapper so that individual hooks (`useFollowing`, `usePushNotifications`) do not each manage token attachment independently.
4. WHEN the server responds with HTTP 401 to a Protected_Endpoint request, THE Auth_Client SHALL always clear the stored JWT, prompt the user to re-authenticate, and retry the original request once after successful re-authentication, regardless of any other authentication state that may exist.

---

### Requirement 7: Server-Side JWT Validation (Auth Filter)

**User Story:** As a backend operator, I want the server to reject write requests that lack a valid JWT so that no client can modify another user's data.

#### Acceptance Criteria

1. WHEN a request arrives at a Protected_Endpoint, THE Auth_Filter SHALL extract the Bearer token from the `Authorization` header.
2. WHEN the Bearer token is a valid, unexpired JWT signed with `JWT_SECRET`, THE Auth_Filter SHALL allow the request to proceed and make the authenticated `sub` (wallet address) available to the controller.
3. WHEN the Bearer token is absent, malformed, expired, or signed with a different secret, THE Auth_Filter SHALL return HTTP 401 with body `{ "error": "Unauthorized" }` before the request reaches the controller.
4. WHEN the `sub` claim in the JWT does not match the `userAddress` field in the request body (case-insensitive), THE Auth_Filter SHALL return HTTP 403 with body `{ "error": "Forbidden: token subject does not match request address" }`.
5. THE Auth_Filter SHALL apply only to Protected_Endpoints and SHALL NOT interfere with unauthenticated read endpoints (`GET /api/follows/{address}`, `GET /api/traders`, `GET /api/markets`, `GET /api/health`).
6. THE Auth_Service SHALL expose `GET /api/auth/nonce` and `POST /api/auth/verify` as public endpoints that do not require a JWT.

---

### Requirement 8: Nonce Storage

**User Story:** As a backend operator, I want nonce state to be stored in the existing PostgreSQL database so that the service remains stateless across restarts and multiple instances.

#### Acceptance Criteria

1. THE Auth_Service SHALL store issued nonces in a dedicated `auth_nonces` table with columns: `wallet_address TEXT`, `nonce TEXT`, `expires_at TIMESTAMPTZ`, `used BOOLEAN DEFAULT FALSE`.
2. WHEN a nonce is validated, THE Auth_Service SHALL update the `used` column to `TRUE` in the same database transaction as JWT issuance.
3. THE Auth_Service SHALL add the `CREATE TABLE IF NOT EXISTS auth_nonces ...` DDL to the existing `schema.sql` so the table is created automatically on server startup.
4. WHEN the Auth_Service starts, THE Auth_Service SHALL schedule a periodic cleanup that deletes rows from `auth_nonces` where `expires_at < NOW()`, running at most every 10 minutes, to prevent unbounded table growth.

---

### Requirement 9: Upgrade Wallet Connection UX to Support Signing

**User Story:** As a new user, I want the wallet connection flow to guide me through signing a challenge so that I understand I am proving ownership, not just entering an address.

#### Acceptance Criteria

1. WHEN the user taps "Connect" in the ProfileScreen, THE Auth_Client SHALL present a two-step modal: Step 1 collects the Wallet_Address (existing behaviour); Step 2 presents the signing prompt after the nonce is fetched.
2. WHEN Step 1 is completed, THE Auth_Client SHALL immediately request a nonce for the entered Wallet_Address before advancing to Step 2.
3. IF the nonce request fails (network error or server error), THEN THE Auth_Client SHALL display an error message "Unable to reach server — check your connection" and remain on Step 1.
4. WHEN the user completes Step 2 and the JWT is successfully received, THE Auth_Client SHALL dismiss the modal and set the wallet as connected in the same manner as the existing `connect()` call.
5. WHEN the user is already connected and the JWT expires, THE Auth_Client SHALL present only Step 2 (the signing prompt) using the already-stored Wallet_Address, without requiring the user to re-enter the address, provided the wallet connection state is CONNECTED.
6. WHEN both the wallet is in a CONNECTED state and the JWT expires, THE Auth_Client SHALL present Step 2 only. IF the wallet is not in a CONNECTED state, THE Auth_Client SHALL present the full two-step modal from Step 1.

---

### Requirement 10: Security Constraints

**User Story:** As a security-conscious user, I want the authentication system to follow standard security practices so that my wallet is protected against common attacks.

#### Acceptance Criteria

1. THE Auth_Service SHALL enforce a maximum of 5 nonce requests per Wallet_Address within any 60-second window and SHALL return HTTP 429 with body `{ "error": "Too many requests" }` when the limit is exceeded.
2. WHEN a JWT is issued, THE Auth_Service SHALL set the `exp` claim to exactly 24 hours after the `iat` claim.
3. THE Auth_Client SHALL NOT log, display in UI text (other than the masked input), or transmit the private key to any endpoint other than the local Signing_Library call.
4. THE Auth_Service SHALL accept only `POST /api/auth/verify` requests with a `Content-Type: application/json` header and SHALL return HTTP 415 for other content types.
5. WHEN the server returns HTTP 401 or HTTP 403 from any Protected_Endpoint, THE Auth_Client SHALL display "Authentication required — please sign in again" to the user and SHALL NOT expose raw server error details.
