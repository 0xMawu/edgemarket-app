# Design Document: Wallet Signature Authentication (SIWE-style)

## Overview

This design adds cryptographic wallet-ownership authentication to the EdgeMarket app using a Sign-In With Ethereum (SIWE) style challenge-response protocol.

The core flow is:
1. Client requests a one-time nonce from the server (`GET /api/auth/nonce?address=…`)
2. User enters their private key in a secure modal; client signs the deterministic Challenge_Message on-device using **ethers v6**
3. Client submits signature to server (`POST /api/auth/verify`)
4. Server recovers the signer address via EIP-191 personal_sign using **web3j**, verifies it matches the stored nonce's address, and issues an HS256 JWT via **jjwt 0.12.x**
5. Client stores the JWT in AsyncStorage (`@edgemarket/jwt`) and injects it as a Bearer token on all Protected_Endpoints via a centralised `apiClient` utility

No WalletConnect dependency is required. The private key never leaves the device and is cleared from memory immediately after signing.

### Key Libraries Added

| Layer | Library | Purpose |
|---|---|---|
| Server | `io.jsonwebtoken:jjwt-api:0.12.6` + impl/jackson | JWT issuance and validation |
| Server | `org.web3j:core:4.10.3` | EIP-191 signature recovery |
| Client | `ethers@6.x` | On-device message signing |

---

## Architecture

The authentication system fits into the existing layered architecture as follows:

```
┌─────────────────────────────────────────────────────────────────┐
│  React Native / Expo 51 (Auth_Client)                           │
│                                                                  │
│  ProfileScreen ──► TwoStepConnectModal                          │
│       │                  │                                       │
│       │            Step1: address entry                         │
│       │            Step2: private key + signing                 │
│       │                                                          │
│  useWalletAuth (expanded)                                        │
│  ├── walletAddress, isConnected  (existing)                     │
│  ├── jwt, authStatus             (new)                          │
│  ├── authenticate()              (new: nonce→sign→verify cycle) │
│  └── proactiveRefresh timer      (new)                          │
│                                                                  │
│  apiClient (src/utils/apiClient.ts)  ◄── NEW                    │
│  └── wraps fetch() with Bearer injection + 401 retry            │
│                                                                  │
│  useFollowing / usePushNotifications                             │
│  └── replace direct fetch() calls with apiClient()             │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTP
┌──────────────────────▼──────────────────────────────────────────┐
│  Spring Boot 3.3 (Auth_Service)                                 │
│                                                                  │
│  AuthController  (GET /api/auth/nonce, POST /api/auth/verify)   │
│  AuthService     (nonce issuance, sig recovery, JWT issuance)   │
│  AuthFilter      (OncePerRequestFilter on Protected_Endpoints)  │
│  NonceCleaner    (@Scheduled, runs every 10 min)                │
│  RateLimiter     (ConcurrentHashMap, sliding window per address)│
│                                                                  │
│  FollowsController / PushTokensController                       │
│  └── now trust Auth_Filter for identity; read sub from request  │
│                                                                  │
│  PostgreSQL (Neon)                                              │
│  └── auth_nonces table (wallet_address, nonce, expires_at, used)│
└─────────────────────────────────────────────────────────────────┘
```

### Authentication Flow Sequence

```
Client                           Server
  │                                │
  │── GET /api/auth/nonce?address= ─►│
  │◄─── { nonce, expiresAt } ───────│  (stored in auth_nonces)
  │                                │
  │  [User enters private key]     │
  │  [ethers: sign Challenge_Msg]  │
  │  [key cleared from memory]     │
  │                                │
  │── POST /api/auth/verify ────────►│
  │   { address, signature }       │  (web3j recovers signer)
  │◄─── { token } ─────────────────│  (nonce marked used, JWT issued)
  │                                │
  │  [JWT stored @edgemarket/jwt]  │
  │                                │
  │── POST /api/follows ────────────►│  Authorization: Bearer <jwt>
  │   { userAddress, targetAddress }│  (Auth_Filter validates; checks sub==userAddress)
  │◄─── 201 Created ───────────────│
```

---

## Components and Interfaces

### Server-Side Components

#### `AuthController`
`GET /api/auth/nonce?address={wallet_address}`
- Validates address format (`^0x[0-9a-fA-F]{40}$`); returns 400 on failure
- Enforces rate limit via `RateLimitService`; returns 429 on excess
- Delegates to `AuthService.issueNonce(address)` → `{ nonce, expiresAt }`

`POST /api/auth/verify`
- Enforces `Content-Type: application/json`; returns 415 otherwise
- Validates required fields (`address`, `signature`); returns 400 if missing
- Delegates to `AuthService.verifyAndIssue(address, signature)` → `{ token }`
- Maps `SignatureVerificationException` → 401, `NonceNotFoundException/ExpiredException` → 401

#### `AuthService`
```java
public interface AuthService {
    NonceResponse issueNonce(String walletAddress);
    TokenResponse verifyAndIssue(String walletAddress, String signature);
}
```

`issueNonce`:
- Generates `SecureRandom` 32 hex-char nonce
- Inserts row into `auth_nonces` with `expires_at = NOW() + 5 minutes`
- Returns `{ nonce, expiresAt }`

`verifyAndIssue`:
- Looks up the most recent unused, unexpired nonce for `walletAddress`
- Constructs Challenge_Message: `"Sign in to EdgeMarket\nAddress: {addr}\nNonce: {nonce}"`
- Calls `web3j Sign.getAddressFromPersonalSign(message, signature)` to recover signer
- Compares recovered address to `walletAddress` (lowercase, case-insensitive)
- On match: marks nonce `used=TRUE` in same transaction; issues JWT via jjwt; returns `{ token }`
- On mismatch: returns 401

#### `RateLimitService`
- `ConcurrentHashMap<String, Deque<Long>>` keyed by `walletAddress`
- Sliding window: evict entries older than 60 seconds; reject if count ≥ 5
- Thread-safe; no external dependencies

#### `AuthFilter` (`OncePerRequestFilter`)
- Applied to Protected_Endpoints only: `POST /api/follows`, `DELETE /api/follows`, `POST /api/push-tokens`, `DELETE /api/push-tokens`
- Extracts `Authorization: Bearer <token>` header
- Validates JWT using jjwt `Jwts.parser().verifyWith(secretKey)…`
- On valid token: stores authenticated `sub` in `HttpServletRequest` attribute `"authenticatedAddress"`
- On missing/invalid/expired token: returns 401 `{ "error": "Unauthorized" }`
- After controller validation: controllers check `sub == request.userAddress` (case-insensitive); return 403 if mismatch

#### `NonceCleaner`
- `@Scheduled(fixedDelay = 600_000)` — runs every 10 minutes
- Executes `DELETE FROM auth_nonces WHERE expires_at < NOW()`

### Client-Side Components

#### `useWalletAuth` (expanded)

New interface:
```typescript
export type AuthStatus = 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

export interface WalletAuthState {
  // existing
  walletAddress: string | null;
  isConnected: boolean;
  connect: (address: string) => Promise<void>;
  disconnect: () => Promise<void>;
  // new
  jwt: string | null;
  authStatus: AuthStatus;
  authenticate: () => Promise<void>;  // triggers nonce→sign→verify cycle
  clearAuth: () => Promise<void>;     // clears JWT without disconnecting wallet
}
```

New storage key: `@edgemarket/jwt`

Startup rehydration: loads both `@edgemarket/wallet` and `@edgemarket/jwt` on mount; decodes JWT exp; schedules proactive refresh if valid.

Proactive refresh: `useEffect` with a `setTimeout` set to `(exp - iat - 60) * 1000` ms. On trigger, calls `authenticate()` silently.

#### `src/utils/apiClient.ts` (new)

```typescript
export async function apiRequest(
  url: string,
  options: RequestInit,
  getJwt: () => string | null,
  onUnauthorized: () => Promise<void>,
): Promise<Response>
```

Behaviour:
1. Reads JWT from `getJwt()`; injects `Authorization: Bearer <jwt>` if present
2. Executes fetch
3. If response is 401: calls `onUnauthorized()` (clears JWT, triggers re-auth), then retries exactly once with new JWT
4. Returns final response

Individual hooks (`useFollowing`, `usePushNotifications`) import and use `apiClient` instead of raw `fetch`.

#### `TwoStepConnectModal` (replaces existing single-step modal in ProfileScreen)

Step 1 — Address Entry:
- TextInput for wallet address (existing behaviour)
- On "Next": validates `0x…40hex`, calls `GET /api/auth/nonce`, advances to Step 2
- On nonce failure: shows "Unable to reach server — check your connection", stays on Step 1

Step 2 — Signing:
- Displays truncated wallet address for confirmation
- `TextInput` with `secureTextEntry={true}` for private key
- Validates 64-char hex (with/without `0x`); derives address from key via ethers; matches against wallet address
- Signs Challenge_Message via `ethers.Wallet.signMessage()`
- Immediately calls `setPrivateKey('')` and sets variable to empty string after sign
- On success: calls `POST /api/auth/verify`; on JWT receipt: calls existing `connect(address)` + stores JWT

Re-auth path (wallet CONNECTED, JWT expired): ProfileScreen presents Step 2 only (with stored `walletAddress`).

---

## Data Models

### Server

#### `auth_nonces` table (addition to `schema.sql`)
```sql
CREATE TABLE IF NOT EXISTS auth_nonces (
  id             SERIAL PRIMARY KEY,
  wallet_address TEXT        NOT NULL,
  nonce          TEXT        NOT NULL UNIQUE,
  expires_at     TIMESTAMPTZ NOT NULL,
  used           BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_auth_nonces_address
  ON auth_nonces (wallet_address, used, expires_at);
```

#### Java DTOs
```java
// Request / Response records (immutable)
record NonceResponse(String nonce, String expiresAt) {}
record VerifyRequest(String address, String signature) {}
record TokenResponse(String token) {}
record ErrorResponse(String error) {}
```

#### JWT Claims
```json
{
  "sub": "<lowercase_wallet_address>",
  "iat": 1700000000,
  "exp": 1700086400
}
```

### Client

#### AsyncStorage keys
| Key | Value |
|---|---|
| `@edgemarket/wallet` | `string` — lowercase wallet address (existing) |
| `@edgemarket/jwt` | `string` — raw JWT (new) |

#### `AuthStatus` state machine
```
unauthenticated ──authenticate()──► authenticating
authenticating  ──success──────────► authenticated
authenticating  ──failure──────────► error
authenticated   ──exp−60s timer──► authenticating  (proactive refresh)
authenticated   ──401 received──► unauthenticated
authenticated   ──disconnect────► unauthenticated
error           ──authenticate()──► authenticating
```

### `pom.xml` additions
```xml
<!-- JWT -->
<dependency>
  <groupId>io.jsonwebtoken</groupId>
  <artifactId>jjwt-api</artifactId>
  <version>0.12.6</version>
</dependency>
<dependency>
  <groupId>io.jsonwebtoken</groupId>
  <artifactId>jjwt-impl</artifactId>
  <version>0.12.6</version>
  <scope>runtime</scope>
</dependency>
<dependency>
  <groupId>io.jsonwebtoken</groupId>
  <artifactId>jjwt-jackson</artifactId>
  <version>0.12.6</version>
  <scope>runtime</scope>
</dependency>

<!-- Web3j for EIP-191 signature recovery -->
<dependency>
  <groupId>org.web3j</groupId>
  <artifactId>core</artifactId>
  <version>4.10.3</version>
</dependency>
```

### `application.properties` additions
```properties
# JWT — set via environment variable (min 256-bit key)
# export JWT_SECRET="your-256-bit-or-longer-base64-key"
auth.jwt.secret=${JWT_SECRET}
```

### Client `package.json` additions
```json
"ethers": "6.13.4"
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

---

### Property 1: Nonce Format and Persistence Invariant

*For any* valid wallet address (matching `^0x[0-9a-fA-F]{40}$`), calling `issueNonce(address)` SHALL always return a nonce of exactly 32 lowercase hex characters and an `expiresAt` timestamp that is approximately 5 minutes in the future (within ±5 seconds), and the resulting row in `auth_nonces` SHALL have `wallet_address` equal to the normalised (lowercase) input address.

**Validates: Requirements 1.1, 1.2**

---

### Property 2: Nonce Single-Use Invariant

*For any* valid address and successfully-authenticated request, submitting `verifyAndIssue(address, signature)` a second time with the same nonce SHALL always return an error indicating the nonce has been used, regardless of whether the signature is otherwise valid.

**Validates: Requirements 1.3, 8.2**

---

### Property 3: Expired Nonce Rejection

*For any* wallet address with a nonce whose `expires_at` is in the past, calling `verifyAndIssue(address, signature)` SHALL always return an error indicating the nonce is expired, regardless of whether the signature is otherwise valid.

**Validates: Requirements 1.4, 4.5**

---

### Property 4: Address Format Validation

*For any* string that does not match `^0x[0-9a-fA-F]{40}$` (e.g. wrong length, missing `0x` prefix, non-hex characters, empty string), the nonce endpoint SHALL always return HTTP 400 with body `{ "error": "Invalid wallet address" }`.

**Validates: Requirements 1.5**

---

### Property 5: Challenge Message Construction Consistency

*For any* wallet address `addr` and nonce string `n`, the Challenge_Message construction function — whether called server-side (Java) or client-side (TypeScript) — SHALL always produce the identical string `"Sign in to EdgeMarket\nAddress: " + addr.toLowerCase() + "\nNonce: " + n`. No implementation variation is permitted.

**Validates: Requirements 2.1, 2.2**

---

### Property 6: Private Key Validation

*For any* input string, the client-side private key validator SHALL accept it if and only if it is exactly 64 hexadecimal characters (optionally preceded by `0x`), and SHALL reject all other strings — including strings that differ by a single character, contain whitespace, or have wrong length.

**Validates: Requirements 3.3, 3.4**

---

### Property 7: Sign-Verify Round Trip

*For any* valid Ethereum private key `k`, the wallet address `A` derived from `k` via ethers, and a challenge message `M` constructed from `A` and any nonce, signing `M` with `k` using `ethers.Wallet.signMessage(M)` and then recovering the signer via web3j's EIP-191 `Sign.getAddressFromPersonalSign(M, sig)` SHALL always return an address that equals `A` (case-insensitive). This property validates that the client signing implementation and server recovery implementation are mutually compatible.

**Validates: Requirements 2.3, 3.5, 3.7, 4.1**

---

### Property 8: JWT Claims Structure

*For any* valid address/signature pair that passes authentication, the JWT returned by `verifyAndIssue` SHALL always contain: `sub` equal to the lowercase wallet address, `iat` equal to the Unix timestamp at issuance (within ±2 seconds of server clock), and `exp` equal to exactly `iat + 86400`. The token SHALL be verifiable using the `JWT_SECRET` configured in the environment.

**Validates: Requirements 4.2, 4.3, 10.2**

---

### Property 9: Signature Mismatch Rejection

*For any* signature not produced by the private key corresponding to the claimed wallet address, `verifyAndIssue(address, signature)` SHALL always return HTTP 401. This includes random signatures, signatures for a different address, and signatures of a different message.

**Validates: Requirements 4.4**

---

### Property 10: JWT Storage and Rehydration Round Trip

*For any* JWT string `t` received from a successful `verifyAndIssue`, storing `t` via the `useWalletAuth` hook and then re-initialising the hook (simulating app restart) SHALL always result in `jwt === t` being the initial state, meaning the token survives the storage/rehydration cycle with no mutation.

**Validates: Requirements 5.1, 5.2**

---

### Property 11: Disconnect Clears All Auth State

*For any* connected and authenticated wallet state (any `walletAddress`, any `jwt`), calling `disconnect()` SHALL always result in `walletAddress === null`, `jwt === null`, `authStatus === "unauthenticated"`, and AsyncStorage having no entries for `@edgemarket/wallet` or `@edgemarket/jwt`.

**Validates: Requirements 5.3**

---

### Property 12: Bearer Token Injection

*For any* non-null JWT string `t` and any URL, `apiRequest()` SHALL always include the header `Authorization: Bearer <t>` in the outgoing request. Conversely, when `jwt` is null, the `Authorization` header SHALL be absent.

**Validates: Requirements 6.1**

---

### Property 13: 401 Response Triggers JWT Clear and Single Retry

*For any* request to a Protected_Endpoint that receives an HTTP 401 response, `apiRequest()` SHALL always: (1) invoke `onUnauthorized()` exactly once, (2) clear the stored JWT, (3) retry the request exactly once with a fresh JWT obtained after re-authentication, and (4) not retry a third time regardless of the second response.

**Validates: Requirements 5.5, 6.2, 6.4, 10.5**

---

### Property 14: Auth Filter Token Validation

*For any* token value presented in the `Authorization` header on a Protected_Endpoint: if the token is a valid, unexpired HS256 JWT signed with `JWT_SECRET`, the Auth_Filter SHALL allow the request through; for all other token values (absent, malformed, wrong signature, expired), the Auth_Filter SHALL return HTTP 401 before the controller is reached. Furthermore, for any two distinct wallet addresses where the JWT `sub` is `addressA` but the request body `userAddress` is `addressB`, the endpoint SHALL return HTTP 403.

**Validates: Requirements 7.1, 7.2, 7.3, 7.4**

---

### Property 15: Read Endpoints Unaffected by Auth Filter

*For any* request to a read endpoint (`GET /api/follows/{address}`, `GET /api/traders`, `GET /api/markets`, `GET /api/health`, `GET /api/auth/nonce`, `POST /api/auth/verify`) without an `Authorization` header, the Auth_Filter SHALL NOT return 401; these endpoints SHALL respond with their normal status codes.

**Validates: Requirements 7.5, 7.6**

---

### Property 16: Rate Limiting Enforcement

*For any* wallet address, making exactly 6 nonce requests within a 60-second sliding window SHALL always result in the 6th request returning HTTP 429 with body `{ "error": "Too many requests" }`, while each of the first 5 requests (within the window) SHALL return 200.

**Validates: Requirements 10.1**

---

### Property 17: Content-Type Enforcement on Verify

*For any* request to `POST /api/auth/verify` with a `Content-Type` header that is not `application/json` (e.g. `text/plain`, `application/x-www-form-urlencoded`, absent), the Auth_Service SHALL always return HTTP 415, regardless of the request body contents.

**Validates: Requirements 10.4**

---

### Property 18: Two-Step Modal Step Progression

*For any* valid wallet address entered in Step 1 of the connect modal, the Auth_Client SHALL always make a nonce API request with that exact address before advancing to Step 2, meaning it is impossible to reach Step 2 without a successful nonce fetch for the entered address.

**Validates: Requirements 9.1, 9.2**

---

### Property 19: Re-Auth Step 2 Only When Connected

*For any* app state where `isConnected === true` and the current JWT is expired (or absent), presenting the auth modal SHALL always start at Step 2 (private key entry) using the already-stored `walletAddress`, never at Step 1. Conversely, when `isConnected === false`, the modal SHALL always start at Step 1.

**Validates: Requirements 9.5, 9.6**

---

## Error Handling

### Server

| Scenario | HTTP Status | Response Body |
|---|---|---|
| Missing/invalid `address` query param on nonce request | 400 | `{ "error": "Invalid wallet address" }` |
| Rate limit exceeded (>5 nonce requests / 60s) | 429 | `{ "error": "Too many requests" }` |
| Missing `address` or `signature` in verify body | 400 | `{ "error": "address and signature are required" }` |
| Wrong `Content-Type` on `POST /api/auth/verify` | 415 | Spring default |
| Signature recovery mismatch | 401 | `{ "error": "Signature verification failed" }` |
| Nonce expired or already used | 401 | `{ "error": "Nonce expired or already used" }` |
| No valid JWT on Protected_Endpoint | 401 | `{ "error": "Unauthorized" }` |
| JWT `sub` ≠ request `userAddress` | 403 | `{ "error": "Forbidden: token subject does not match request address" }` |
| DB or unexpected error | 500 | `{ "error": "Internal server error" }` |

**Error sanitisation**: All server error responses use generic messages only. No stack traces, SQL details, or internal state are returned to the client.

### Client

| Scenario | UI Behaviour |
|---|---|
| Nonce request fails (network/server) | "Unable to reach server — check your connection" (stays on Step 1) |
| Invalid private key format | "Invalid private key — must be a 64-character hex string" |
| Private key doesn't match wallet address | "Private key does not match connected wallet address" |
| Server 401 on verify | Treated as "Signature verification failed" — display generic auth error |
| 401/403 on Protected_Endpoint | Clear JWT; display "Authentication required — please sign in again"; prompt Step 2 modal |
| Re-auth fails after 401 retry | Surface "Authentication required — please sign in again"; block operation |

**Private key security**: The private key TypeScript state variable is set to `''` (empty string) immediately after `signMessage()` resolves or rejects. It is never serialised, logged via `console.*`, passed as a function argument beyond the local signing call, or stored in any React context or AsyncStorage key.

---

## Testing Strategy

### Property-Based Testing Library

Server-side: **jqwik** (Java property-based testing framework for JUnit 5) — already compatible with Spring Boot 3.3's test infrastructure.

Client-side: **fast-check** (TypeScript PBT library) — install with `npm install --save-dev fast-check`.

Each property test runs a **minimum of 100 iterations**.

---

### Server-Side Tests

#### Property Tests (jqwik)
Each property test maps to a design property above and is tagged accordingly.

```
// Tag format: @Label("Feature: wallet-signature-auth, Property N: <property_text>")
```

| Test | Design Property | Key generators |
|---|---|---|
| Nonce format and persistence | Property 1 | `@ForAll` valid Ethereum addresses (regex-constrained) |
| Nonce single-use | Property 2 | Valid address + sign pair |
| Expired nonce rejection | Property 3 | Address + past-dated nonce |
| Address format validation | Property 4 | `@ForAll @StringLength` arbitrary strings excluding valid address pattern |
| Challenge message construction | Property 5 | Arbitrary `address` + `nonce` strings |
| Sign-verify round trip | Property 7 | Valid 32-byte hex private keys |
| JWT claims structure | Property 8 | Valid key/address pairs |
| Signature mismatch rejection | Property 9 | Wrong-address signatures |
| Auth Filter validation | Property 14 | Valid/invalid JWTs via `@Provide` |
| Rate limit enforcement | Property 16 | Wallet addresses |
| Content-Type enforcement | Property 17 | Non-JSON Content-Type values |

#### Unit / Example Tests (JUnit 5)
- `AuthService`: specific examples for each error path (missing nonce, DB exception handling)
- `AuthFilter`: request with no `Authorization` header, with `Bearer` but missing value
- `NonceCleaner`: verify `@Scheduled` cleanup SQL is correct
- `FollowsController` + `PushTokensController`: with valid JWT injected, 401 on missing JWT, 403 on sub mismatch

#### Integration Tests
- Full Spring context with H2 (or embedded Postgres) to test end-to-end nonce → sign → verify → Protected_Endpoint flow
- `schema.sql` DDL verification (Property 15 / Req 8.3)

---

### Client-Side Tests

#### Property Tests (fast-check)
Minimum 100 runs per test.

```typescript
// Tag format: // Feature: wallet-signature-auth, Property N: <property_text>
```

| Test | Design Property | Key generators |
|---|---|---|
| Private key format validation | Property 6 | `fc.string()` — arbitrary strings, including valid 64-hex variants |
| Challenge message consistency | Property 5 | `fc.hexaString()` for address suffix + `fc.string()` for nonce |
| Bearer token injection | Property 12 | `fc.string()` for JWT values |
| 401 triggers clear + single retry | Property 13 | Various mock response sequences |
| JWT storage/rehydration round trip | Property 10 | `fc.string()` for JWT strings |
| Disconnect clears all state | Property 11 | Any connected state |
| Two-step modal step progression | Property 18 | Valid address strings |
| Re-auth shows Step 2 only when connected | Property 19 | `isConnected` boolean + JWT expiry state |

#### Unit / Example Tests (Jest + React Testing Library)
- `TwoStepConnectModal`: Step 1 renders address input; Step 2 renders `secureTextEntry` key input (Req 3.2)
- `useWalletAuth`: exposes `jwt` and `authStatus` (Req 5.6)
- Private key not persisted to AsyncStorage (Req 3.9) — mock `AsyncStorage.setItem` and verify never called with key value
- Proactive refresh timer: mock JWT with `exp = now + 30s`, verify `authenticate()` is called before expiry

#### Integration / E2E (Detox, optional)
- Full sign-in flow on a physical device or emulator: address entry → nonce fetch → key entry → sign → JWT stored → follow action succeeds with auth header

---

### Coverage Targets
- Server: all `AuthService` and `AuthFilter` branches covered by property + unit tests
- Client: `apiClient.ts` 100% branch coverage (especially 401 retry path)
- `useWalletAuth`: all `AuthStatus` state transitions covered
