# Design Document: Email/Password Authentication (Phase 8)

## Overview

This design adds email/password authentication as the primary identity layer for EdgeMarket. Every user must register, verify their email via a 6-digit code, and log in before accessing any app screen.

The key design decisions:
- **Same JWT infrastructure**: Shares `JWT_SECRET`, HS256 signing, and the existing `AuthFilter` with the wallet-signature-auth spec. The `sub` claim distinguishes the two: a UUID for email-auth users, a wallet address for wallet-signature-auth users.
- **Spring Boot additions**: New `EmailAuthController`, `EmailAuthService`, `EmailVerificationService`, and `SendGridEmailService` classes. The existing `AuthController`, `AuthServiceImpl`, and `AuthFilter` are not removed.
- **React Native additions**: New `useAuth` hook backed by `AuthContext`, three new screens (`SignupScreen`, `LoginScreen`, `VerifyEmailScreen`), and an `AuthNavigator` / `AuthGuard` wrapper. The existing `useWalletAuth` hook and `TwoStepConnectModal` remain for the wallet-link flow.
- **Controller migration**: `FollowsController` and `PushTokensController` are updated to read the caller's identity from the JWT `sub` (via the `authenticatedAddress` request attribute), resolving UUID-to-wallet-address via the `users` table when needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  React Native / Expo 51                                              │
│                                                                      │
│  App.tsx                                                             │
│  └── AuthProvider (AuthContext)                                     │
│       └── AuthGuard                                                 │
│            ├── AuthNavigator  (unauthenticated)                     │
│            │    ├── LoginScreen                                      │
│            │    ├── SignupScreen                                     │
│            │    └── VerifyEmailScreen                               │
│            └── RootNavigator  (authenticated + verified)            │
│                 └── [all existing tabs]                             │
│                                                                      │
│  useAuth (hook)                                                      │
│  ├── authState: 'loading' | 'unauthenticated' | 'authenticated'     │
│  ├── currentUser: { id, email, emailVerified, walletAddress }       │
│  ├── signup / login / verifyEmail / resendCode / logout             │
│  ├── getJwt() → string | null                                       │
│  └── JWT in AsyncStorage (@edgemarket/email-jwt)                    │
│                                                                      │
│  apiRequest() [existing]  ←── getJwt() wired from useAuth           │
└────────────────────────────┬────────────────────────────────────────┘
                             │ HTTP / Bearer JWT
┌────────────────────────────▼────────────────────────────────────────┐
│  Spring Boot 3.3                                                     │
│                                                                      │
│  EmailAuthController  /api/auth/signup, /verify-email,              │
│                       /resend-code, /login, /me                     │
│  EmailAuthService     signup, login, verifyEmail, resendCode        │
│  SendGridEmailService async email dispatch via SendGrid HTTP API     │
│  EmailRateLimitService  sliding-window, 3 resends/email/hour        │
│                                                                      │
│  AuthFilter (existing, extended) — now also guards GET /api/auth/me │
│  AuthController (existing, unchanged)                               │
│  AuthServiceImpl (existing, unchanged)                              │
│                                                                      │
│  FollowsController (updated)   — identity from JWT sub              │
│  PushTokensController (updated) — identity from JWT sub             │
│                                                                      │
│  PostgreSQL (Neon)                                                   │
│  ├── users                                                          │
│  └── email_verification_codes                                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Authentication Flow — Signup + Verify

```
Client                                  Server
  │                                        │
  │── POST /api/auth/signup ───────────────►│
  │   { email, password }                  │  creates user (unverified)
  │                                        │  generates code → SendGrid (async)
  │◄── 201 { message } ───────────────────│
  │                                        │
  │  [User reads code from email]         │
  │                                        │
  │── POST /api/auth/verify-email ─────────►│
  │   { email, code }                      │  marks verified, marks code consumed
  │◄── 200 { token } ─────────────────────│  JWT sub = user UUID
  │                                        │
  │  [AuthGuard transitions to RootNav]   │
```

### Authentication Flow — Login

```
Client                                  Server
  │                                        │
  │── POST /api/auth/login ────────────────►│
  │   { email, password }                  │  bcrypt.verify + check email_verified
  │◄── 200 { token }  (verified user) ────│
  │   OR 403 { error } (unverified) ──────│
  │   OR 401 { error } (wrong creds) ─────│
  │                                        │
  │  [AuthGuard transitions to RootNav]   │
```

---

## Components and Interfaces

### Server-Side

#### `EmailAuthController`
Maps to `/api/auth` (new endpoints alongside existing `AuthController`):

```java
POST /api/auth/signup        — EmailAuthController.signup(SignupRequest)
POST /api/auth/verify-email  — EmailAuthController.verifyEmail(VerifyEmailRequest)
POST /api/auth/resend-code   — EmailAuthController.resendCode(ResendCodeRequest)
POST /api/auth/login         — EmailAuthController.login(LoginRequest)
GET  /api/auth/me            — EmailAuthController.me(HttpServletRequest)
```

All write endpoints consume `application/json`; return 415 for other content types.

The `/me` endpoint reads `authenticatedUserId` from the request attribute (set by `AuthFilter`) and queries the `users` table.

#### `EmailAuthService` interface

```java
public interface EmailAuthService {
    void signup(String email, String password);           // throws DuplicateEmailException
    String verifyEmail(String email, String code);        // returns JWT; throws InvalidCodeException
    String login(String email, String password);          // returns JWT; throws InvalidCredentialsException, EmailNotVerifiedException
    void resendCode(String email);                        // throws TooManyResendsException, AlreadyVerifiedException
    UserDto getUser(UUID userId);                         // throws UserNotFoundException
}
```

#### `EmailAuthServiceImpl`

- **signup**: Validates email (regex) and password (≥8 chars). Checks `users` for duplicate email (throws `DuplicateEmailException` → 409). Hashes password with BCrypt cost 10. Inserts into `users`. Generates 6-digit code via `SecureRandom`. Inserts into `email_verification_codes`. Calls `SendGridEmailService.sendVerificationCodeAsync(email, code)`.
- **verifyEmail**: Looks up user by email. Queries most recent unconsumed, unexpired code for `user_id`. If none or code mismatch → `InvalidCodeException` (400). On match: updates `email_verified = true` and `consumed_at = NOW()` in a single transaction. Issues JWT: `sub = user_id.toString()`, `iat`, `exp = iat + 86400`, signed HS256 with `JWT_SECRET`.
- **login**: Looks up user by email. If not found → `InvalidCredentialsException` (401). BCrypt verify; if fails → `InvalidCredentialsException` (401). If `email_verified = false` → `EmailNotVerifiedException` (403). Issues JWT.
- **resendCode**: Checks `EmailRateLimitService.allow(email)` (throws 429 if exceeded). If user not found, returns silently (no-op, 200 response). If already verified, throws `AlreadyVerifiedException` (400). Sets `consumed_at = NOW()` on all existing unconsumed codes. Generates new code. Inserts and sends via SendGrid async.
- **getUser**: Queries `users` by `id`; maps to `UserDto`.

#### `SendGridEmailService`

```java
@Service
public class SendGridEmailService {
    // Uses SENDGRID_API_KEY from environment via @Value("${sendgrid.api.key}")
    // Sends HTTP POST to https://api.sendgrid.com/v3/mail/send
    // Wrapped in CompletableFuture.runAsync() — non-blocking
    public void sendVerificationCodeAsync(String toEmail, String code);
}
```

Email body text: `"Your EdgeMarket verification code is: {code}\n\nThis code expires in 10 minutes."`

SendGrid failures are caught and logged at WARN level; they do not propagate to the caller.

#### `EmailRateLimitService`

Extends the same sliding-window pattern as `RateLimitService`:
- Key: email address (lowercase)
- Window: 3600 seconds (1 hour)
- Max: 3 requests

```java
@Service
public class EmailRateLimitService {
    public boolean allow(String email); // true = allow, false = rate-limited
}
```

#### DTOs (new records in `com.edgemarket.model`)

```java
record SignupRequest(String email, String password) {}
record VerifyEmailRequest(String email, String code) {}
record ResendCodeRequest(String email) {}
record LoginRequest(String email, String password) {}
record UserDto(UUID id, String email, boolean emailVerified, String walletAddress) {}
```

#### Custom Exceptions (new, in `com.edgemarket.exception`)

```java
class DuplicateEmailException extends RuntimeException {}
class InvalidCodeException extends RuntimeException {}
class InvalidCredentialsException extends RuntimeException {}
class EmailNotVerifiedException extends RuntimeException { String message; }
class TooManyResendsException extends RuntimeException {}
class AlreadyVerifiedException extends RuntimeException {}
class UserNotFoundException extends RuntimeException {}
```

#### `AuthFilter` changes (minimal)

Add `"GET /api/auth/me"` to the `PROTECTED` set. The sub extracted from the JWT (either a UUID string or a wallet address) is stored as `authenticatedAddress` request attribute — no structural change needed.

#### `FollowsController` and `PushTokensController` changes

Current behaviour: accept `userAddress` from request body; validate against `authenticatedAddress`.

New behaviour:
1. Read `authenticatedAddress` from request attribute (set by `AuthFilter`).
2. If it matches `^0x[0-9a-fA-F]{40}$` (wallet-signature-auth user): use as `user_address` directly.
3. Otherwise (UUID string — email-auth user): query `SELECT wallet_address FROM users WHERE id = ?::uuid`. If `wallet_address IS NULL`, return 422 `{ "error": "No wallet linked to this account" }`.
4. Remove the body `userAddress` field dependency for identity; `targetAddress` remains in body for follows operations.

### Client-Side

#### `AuthContext` and `AuthProvider`

```typescript
interface AuthContextValue {
  authState: 'loading' | 'unauthenticated' | 'authenticated';
  currentUser: CurrentUser | null;
  error: string | null;
  getJwt: () => string | null;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface CurrentUser {
  id: string;         // UUID
  email: string;
  emailVerified: boolean;
  walletAddress: string | null;
}
```

`AuthProvider` wraps the app in `App.tsx`; `useAuth()` is a convenience hook that reads from `AuthContext`.

#### `useAuth` implementation

- **Storage key**: `@edgemarket/email-jwt`
- **Mount behaviour**: Set `authState = 'loading'`. Load JWT from AsyncStorage. If present and not expired (decode `exp` from payload without signature verification): call `GET /api/auth/me`. On 200: set `authState = 'authenticated'`, populate `currentUser`. On 401 or error: remove JWT, set `authState = 'unauthenticated'`. If no JWT or expired: set `authState = 'unauthenticated'`.
- **signup**: POST `/api/auth/signup`. On 201: no JWT yet, navigate to `VerifyEmailScreen` (caller navigates based on no error thrown).
- **login**: POST `/api/auth/login`. On 200: store JWT, call `/api/auth/me`, set `authState = 'authenticated'`.
- **verifyEmail**: POST `/api/auth/verify-email`. On 200: store JWT, call `/api/auth/me`, set `authState = 'authenticated'`.
- **resendCode**: POST `/api/auth/resend-code`. Throws on non-200 so caller can display error.
- **logout**: Remove JWT from AsyncStorage, clear `currentUser`, set `authState = 'unauthenticated'`.
- **getJwt**: Returns current JWT string or null.

#### `AuthGuard`

```typescript
function AuthGuard() {
  const { authState } = useAuth();
  if (authState === 'loading') return <LoadingScreen />;
  if (authState === 'authenticated') return <RootNavigator />;
  return <AuthNavigator />;
}
```

#### `AuthNavigator`

```typescript
type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  VerifyEmail: { email: string };
};
const AuthStack = createNativeStackNavigator<AuthStackParamList>();
```

#### `SignupScreen`

- Two `TextInput` fields: email, password (`secureTextEntry`).
- "Create Account" button → calls `signup(email, password)`.
- On success (no error): navigate to `VerifyEmail` with `{ email }`.
- On 409: show "An account with this email already exists."
- On 400: show the `error` field from the server response.
- Link to `LoginScreen`.

#### `LoginScreen`

- Two `TextInput` fields: email, password (`secureTextEntry`).
- "Sign In" button → calls `login(email, password)`.
- On success: `AuthGuard` transitions automatically.
- On 401: show "Invalid email or password."
- On 403: show server error message + "Resend Code" button → navigate to `VerifyEmail` with `{ email }`.
- Link to `SignupScreen`.

#### `VerifyEmailScreen`

- Displays email from navigation params or `currentUser`.
- 6-digit `TextInput` (numeric keyboard).
- "Verify" button → calls `verifyEmail(email, code)`.
- On success: `AuthGuard` transitions automatically.
- On 400: show "Invalid or expired code. Please try again."
- "Resend Code" button → calls `resendCode(email)`.
- On 429: show "Too many resend requests. Try again later."
- On 200: show "A new code has been sent to your email."

#### `App.tsx` changes

Wrap `NavigationContainer` with `<AuthProvider>` and replace `<RootNavigator />` with `<AuthGuard />`.

---

## Data Models

### PostgreSQL Tables (additions to `schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS users (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT        NOT NULL UNIQUE,
  password_hash    TEXT        NOT NULL,
  wallet_address   TEXT,
  email_verified   BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code         VARCHAR(6)  NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evc_user_id
  ON email_verification_codes (user_id, consumed_at, expires_at);
```

### `pom.xml` additions

```xml
<!-- BCrypt password hashing -->
<dependency>
  <groupId>org.springframework.security</groupId>
  <artifactId>spring-security-crypto</artifactId>
  <version>6.3.0</version>
</dependency>
```

> `spring-security-crypto` provides `BCryptPasswordEncoder` without pulling in the full Spring Security filter chain.

### `application.properties` additions

```properties
# SendGrid
sendgrid.api.key=${SENDGRID_API_KEY}
sendgrid.from.email=noreply@edgemarket.app
```

### AsyncStorage keys (client)

| Key | Value |
|---|---|
| `@edgemarket/email-jwt` | `string` — raw JWT for email-auth session |
| `@edgemarket/wallet` | (existing) wallet address |
| `@edgemarket/jwt` | (existing) wallet-signature-auth JWT |

### JWT Claims (email-auth)

```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "iat": 1700000000,
  "exp": 1700086400
}
```

The `sub` is a UUID string — distinguishable from wallet-address subs (which start with `0x`).

---

## Correctness Properties

### Property 1: Password Never Stored in Plaintext

*For any* signup or login request with password `p`, the value stored in `users.password_hash` SHALL always satisfy `BCrypt.checkpw(p, password_hash) == true` and SHALL NOT equal `p`. No log statement, HTTP response body, or database column SHALL contain `p`.

**Validates: Requirements 1.7, 1.8, 4.6, 14.1**

---

### Property 2: Verification Code Single-Use

*For any* valid verification code `c` that has been successfully used to verify an email (i.e., `consumed_at IS NOT NULL`), a subsequent call to `verifyEmail(email, c)` SHALL always return HTTP 400 with `{ "error": "Invalid or expired code" }`, regardless of whether the email and code match.

**Validates: Requirements 2.3, 14.4**

---

### Property 3: Verification Code Expiry

*For any* verification code whose `expires_at` is in the past, a call to `verifyEmail(email, code)` SHALL always return HTTP 400 with `{ "error": "Invalid or expired code" }`, even if the code digits are correct.

**Validates: Requirements 2.3, 14.4**

---

### Property 4: Login Credential Indistinguishability

*For any* email `e` that does not exist in the `users` table, and for any email `e2` that does exist with an incorrect password: both calls to `POST /api/auth/login` SHALL return the identical HTTP status (401) and the identical response body (`{ "error": "Invalid credentials" }`). No timing difference large enough to be measured over the network SHALL exist.

**Validates: Requirements 4.4, 14.2**

---

### Property 5: Verify-Email Indistinguishability

*For any* email `e` that does not exist in the `users` table, and for any email `e2` with an incorrect code: both calls to `POST /api/auth/verify-email` SHALL return the identical HTTP status (400) and the identical body (`{ "error": "Invalid or expired code" }`).

**Validates: Requirements 2.4, 14.3**

---

### Property 6: JWT Sub is User UUID

*For any* successful login or email verification, the JWT returned SHALL have a `sub` claim that is the UUID string of the authenticated user row, parseable as `UUID.fromString(sub)` without throwing.

**Validates: Requirements 2.2, 4.2, 5.1**

---

### Property 7: JWT Expiry is Exactly 24 Hours

*For any* JWT issued by `EmailAuthServiceImpl`, `exp - iat` SHALL equal exactly 86400 seconds.

**Validates: Requirements 4.2, 14.5**

---

### Property 8: Resend Rate Limit

*For any* email address `e`, making exactly 4 resend-code requests within a 60-minute sliding window SHALL result in the 4th request returning HTTP 429. Each of the first 3 requests within the window SHALL return HTTP 200.

**Validates: Requirements 3.3, 14.6**

---

### Property 9: Session Restore Round Trip

*For any* valid JWT string `t` stored in AsyncStorage under `@edgemarket/email-jwt`, re-initialising the `useAuth` hook (simulating an app restart) SHALL always result in a `GET /api/auth/me` call with `Authorization: Bearer t`, and if that call returns 200, `authState` SHALL be `'authenticated'` and `currentUser` SHALL be non-null.

**Validates: Requirements 5.3, 11.3**

---

### Property 10: Logout Clears All State

*For any* authenticated state (any JWT `t`, any `currentUser`), calling `logout()` SHALL always result in `authState === 'unauthenticated'`, `currentUser === null`, and AsyncStorage having no entry for `@edgemarket/email-jwt`.

**Validates: Requirements 6.1, 6.2**

---

### Property 11: Auth Guard Routing Invariant

*For any* `authState` value, the `AuthGuard` SHALL always render `AuthNavigator` when `authState === 'unauthenticated'`, `RootNavigator` when `authState === 'authenticated'`, and a loading indicator when `authState === 'loading'`. No state combination produces an undefined render.

**Validates: Requirements 7.1, 7.5**

---

### Property 12: Controller Identity Resolution

*For any* JWT with `sub` equal to a UUID `u`, a request to `POST /api/follows` or `POST /api/push-tokens` with that JWT SHALL use the `wallet_address` from `users WHERE id = u::uuid` as the `user_address` for database operations — never the UUID itself. *For any* JWT with `sub` equal to a wallet address `w` (matching `^0x[0-9a-fA-F]{40}$`), it SHALL use `w` directly.

**Validates: Requirements 12.1, 12.2, 12.3**

---

## Error Handling

### Server

| Scenario | Status | Body |
|---|---|---|
| Missing/invalid email on signup | 400 | `{ "error": "Valid email is required" }` |
| Password < 8 chars on signup | 400 | `{ "error": "Password must be at least 8 characters" }` |
| Duplicate email on signup | 409 | `{ "error": "Email already registered" }` |
| Missing fields on verify-email | 400 | `{ "error": "email and code are required" }` |
| Wrong/expired/consumed code | 400 | `{ "error": "Invalid or expired code" }` |
| Missing email on resend | 400 | `{ "error": "email is required" }` |
| Email already verified on resend | 400 | `{ "error": "Email already verified" }` |
| Rate limit exceeded on resend | 429 | `{ "error": "Too many resend requests. Try again later." }` |
| Missing fields on login | 400 | `{ "error": "email and password are required" }` |
| Wrong credentials on login | 401 | `{ "error": "Invalid credentials" }` |
| Unverified email on login | 403 | `{ "error": "Email not verified. Check your inbox for the verification code." }` |
| No JWT on `/api/auth/me` | 401 | `{ "error": "Unauthorized" }` (from AuthFilter) |
| No wallet linked on follows/push | 422 | `{ "error": "No wallet linked to this account" }` |
| SendGrid failure | — | Logged WARN, no client impact |
| Unexpected server error | 500 | `{ "error": "Internal server error" }` |

### Client

| Scenario | UI |
|---|---|
| signup 409 | "An account with this email already exists." |
| signup 400 | Server `error` field |
| login 401 | "Invalid email or password." |
| login 403 | Server error + "Resend Code" button |
| verifyEmail 400 | "Invalid or expired code. Please try again." |
| resendCode 429 | "Too many resend requests. Try again later." |
| resendCode 200 | "A new code has been sent to your email." |
| Network error | "Unable to reach server — check your connection." |

---

## Testing Strategy

### Server-Side (JUnit 5 + jqwik)

**Property tests** (jqwik, min 100 iterations each):

| Test | Property |
|---|---|
| BCrypt hash is never plaintext | Property 1 |
| Code single-use | Property 2 |
| Code expiry | Property 3 |
| Login indistinguishability | Property 4 |
| Verify-email indistinguishability | Property 5 |
| JWT sub is UUID | Property 6 |
| JWT exp = iat + 86400 | Property 7 |
| Resend rate limit | Property 8 |
| Controller identity resolution | Property 12 |

**Unit tests** (JUnit 5):
- `EmailAuthServiceImpl`: each error path (duplicate email, invalid code, unverified user, etc.)
- `EmailRateLimitService`: boundary at 3 requests
- `EmailAuthController`: 415 for non-JSON content type on all POST endpoints
- `SendGridEmailService`: verify async invocation, error swallowed

**Integration tests** (Spring Boot test slice + H2 or test PostgreSQL):
- Full signup → verify-email → login flow
- Schema DDL correctness (tables and indexes created)

### Client-Side (Jest + fast-check)

**Property tests** (fast-check, min 100 iterations):

| Test | Property |
|---|---|
| Logout clears all state | Property 10 |
| Auth guard routing | Property 11 |
| Session restore round trip | Property 9 |

**Unit tests** (Jest + React Testing Library):
- `useAuth`: `signup` error states, `login` error states, `verifyEmail` error states
- `AuthGuard`: renders correct navigator for each `authState`
- `SignupScreen`: shows correct error for 409 and 400
- `LoginScreen`: shows 403 path with "Resend Code"
- `VerifyEmailScreen`: shows 400 and 429 error messages
- Password inputs use `secureTextEntry`
