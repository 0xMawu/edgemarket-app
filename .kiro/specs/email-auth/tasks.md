# Implementation Plan: Email/Password Authentication (Phase 8)

## Overview

Implement email/password signup, email verification, login, and session restore for EdgeMarket. The Spring Boot backend gets five new endpoints and two new DB tables. The React Native frontend gets an `AuthContext`/`useAuth` hook, three new screens, and an `AuthGuard` that gates the existing app behind email verification. Existing wallet-signature-auth code is extended (not replaced).

## Tasks

- [x] 1. Extend the PostgreSQL schema with user and verification-code tables
  - Add `CREATE TABLE IF NOT EXISTS users (...)` to `schema.sql` with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `email TEXT NOT NULL UNIQUE`, `password_hash TEXT NOT NULL`, `wallet_address TEXT`, `email_verified BOOLEAN NOT NULL DEFAULT FALSE`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Add `CREATE TABLE IF NOT EXISTS email_verification_codes (...)` with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`, `code VARCHAR(6) NOT NULL`, `expires_at TIMESTAMPTZ NOT NULL`, `consumed_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
  - Add indexes `idx_users_email` and `idx_evc_user_id`
  - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 2. Add server-side dependencies and configuration
  - [x] 2.1 Add `spring-security-crypto` 6.3.0 to `pom.xml` for `BCryptPasswordEncoder`
    - Do NOT add the full Spring Security filter chain starter — only the crypto module
    - _Requirements: 14.1_
  - [x] 2.2 Add `sendgrid.api.key=${SENDGRID_API_KEY}` and `sendgrid.from.email=noreply@edgemarket.app` to `application.properties`
    - _Requirements: 14.8_

- [x] 3. Implement server-side DTOs and custom exceptions
  - [x] 3.1 Create request/response record classes in `com.edgemarket.model`: `SignupRequest`, `VerifyEmailRequest`, `ResendCodeRequest`, `LoginRequest`, `UserDto`
    - `UserDto` fields: `UUID id`, `String email`, `boolean emailVerified`, `String walletAddress`
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_
  - [x] 3.2 Create custom exception classes in `com.edgemarket.exception`: `DuplicateEmailException`, `InvalidCodeException`, `InvalidCredentialsException`, `EmailNotVerifiedException`, `TooManyResendsException`, `AlreadyVerifiedException`, `UserNotFoundException`
    - `EmailNotVerifiedException` should carry the message string
    - _Requirements: 1.6, 2.3, 3.3, 4.3, 4.4_

- [x] 4. Implement `EmailRateLimitService`
  - [x] 4.1 Create `com.edgemarket.service.EmailRateLimitService` using the same sliding-window `ConcurrentHashMap<String, Deque<Long>>` pattern as the existing `RateLimitService`, keyed by lowercase email, window 3600 seconds, max 3 requests
    - _Requirements: 3.3, 14.6_
  - [ ]* 4.2 Write property test for `EmailRateLimitService.allow()` — exactly 4 calls within the hour window should result in the 4th returning `false`
    - **Property 8: Resend Rate Limit**
    - **Validates: Requirements 3.3, 14.6**

- [x] 5. Implement `SendGridEmailService`
  - [x] 5.1 Create `com.edgemarket.service.SendGridEmailService` that injects `${sendgrid.api.key}` and `${sendgrid.from.email}`, builds a JSON payload for the SendGrid v3 `mail/send` endpoint, and calls it via `java.net.http.HttpClient` (or Spring's `RestClient`) inside `CompletableFuture.runAsync()`
    - SendGrid failures must be caught and logged at WARN; they must NOT propagate to the caller
    - Email body: `"Your EdgeMarket verification code is: {code}\n\nThis code expires in 10 minutes."`
    - _Requirements: 1.2, 3.1, 14.7, 14.8_

- [ ] 6. Implement `EmailAuthService` and `EmailAuthServiceImpl`
  - [x] 6.1 Define `com.edgemarket.service.EmailAuthService` interface with methods: `signup`, `verifyEmail` (returns `String` JWT), `login` (returns `String` JWT), `resendCode`, `getUser`
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1_
  - [x] 6.2 Implement `signup` in `EmailAuthServiceImpl`: validate email (RFC-5322 regex) and password length (≥8), check for duplicate email, hash with `BCryptPasswordEncoder(10)`, insert user, generate 6-digit code via `SecureRandom`, insert code with `expires_at = NOW() + 10 min`, call `SendGridEmailService.sendVerificationCodeAsync`
    - Password must NOT be logged or stored; hash only
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 14.1_
  - [ ]* 6.3 Write property test for `signup` — BCrypt hash stored is never equal to input password and always passes `BCryptPasswordEncoder.matches(password, hash)`
    - **Property 1: Password Never Stored in Plaintext**
    - **Validates: Requirements 1.7, 1.8, 14.1**
  - [x] 6.4 Implement `verifyEmail` in `EmailAuthServiceImpl`: query most-recent unconsumed unexpired code for user, compare digits, on match update `email_verified = true` and `consumed_at = NOW()` in a transaction, issue JWT (`sub = user_id.toString()`, `exp = iat + 86400`)
    - Use the same `Jwts.builder()` + `JWT_SECRET` pattern as `AuthServiceImpl`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 14.4, 14.5_
  - [ ]* 6.5 Write property test for code single-use — consuming a code and calling `verifyEmail` again with the same code always returns `InvalidCodeException`
    - **Property 2: Verification Code Single-Use**
    - **Validates: Requirements 2.3, 14.4**
  - [ ]* 6.6 Write property test for code expiry — a code with `expires_at` in the past always produces `InvalidCodeException` regardless of whether digits match
    - **Property 3: Verification Code Expiry**
    - **Validates: Requirements 2.3, 14.4**
  - [x] 6.7 Implement `login` in `EmailAuthServiceImpl`: look up user by email (throw `InvalidCredentialsException` if not found), `BCryptPasswordEncoder.matches` check (throw `InvalidCredentialsException` if fails), check `email_verified` (throw `EmailNotVerifiedException` if false), issue JWT
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 14.1, 14.2_
  - [ ]* 6.8 Write property test for login credential indistinguishability — non-existent email and wrong password for existing email both throw `InvalidCredentialsException` (same exception type and message)
    - **Property 4: Login Credential Indistinguishability**
    - **Validates: Requirements 4.4, 14.2**
  - [x] 6.9 Implement `resendCode` in `EmailAuthServiceImpl`: check rate limit, check `email_verified`, mark existing codes consumed, generate new code, insert and send
    - If user not found by email: return silently (no-op) to avoid email enumeration
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 14.6_
  - [x] 6.10 Implement `getUser` in `EmailAuthServiceImpl`: query `users` by UUID, map to `UserDto`
    - _Requirements: 5.1_
  - [ ]* 6.11 Write property test for JWT sub is UUID — all JWTs issued by `verifyEmail` and `login` have a `sub` that is parseable as `UUID.fromString(sub)`
    - **Property 6: JWT Sub is User UUID**
    - **Validates: Requirements 2.2, 4.2, 5.1**
  - [ ]* 6.12 Write property test for JWT expiry — `exp - iat == 86400` for every issued token
    - **Property 7: JWT Expiry is Exactly 24 Hours**
    - **Validates: Requirements 4.2, 14.5**

- [ ] 7. Implement `EmailAuthController`
  - [-] 7.1 Create `com.edgemarket.controller.EmailAuthController` with `@RequestMapping("/api/auth")` (alongside existing `AuthController`); wire `EmailAuthService` and `EmailRateLimitService`
    - Implement `POST /api/auth/signup` consuming `application/json`, delegating to `emailAuthService.signup()`, returning 201 on success
    - Implement `POST /api/auth/verify-email` returning 200 `{ "token": jwt }` on success
    - Implement `POST /api/auth/resend-code` returning 200 `{ "message": "New code sent" }` on success
    - Implement `POST /api/auth/login` returning 200 `{ "token": jwt }` on success; map `EmailNotVerifiedException` → 403
    - Implement `GET /api/auth/me` reading `authenticatedUserId` from request attribute `"authenticatedAddress"`, calling `emailAuthService.getUser()`, returning 200 `UserDto`
    - Add `@ExceptionHandler` methods for all custom exceptions mapping to correct HTTP status codes
    - All write endpoints must use `consumes = MediaType.APPLICATION_JSON_VALUE` to auto-return 415 for wrong content type
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 3.2, 3.3, 3.5, 3.6, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2_

- [~] 8. Checkpoint — compile the Spring Boot server and confirm all new endpoints return correct status codes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Extend `AuthFilter` and update `FollowsController` / `PushTokensController`
  - [~] 9.1 Add `"GET /api/auth/me"` to the `PROTECTED` set in `AuthFilter`
    - _Requirements: 5.5, 12.5_
  - [~] 9.2 Refactor `FollowsController`: remove body `userAddress` identity dependency; read `authenticatedAddress` from request attribute; if it matches `^0x[0-9a-fA-F]{40}$` use it directly; otherwise query `SELECT wallet_address FROM users WHERE id = ?::uuid` and return 422 if null
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [~] 9.3 Refactor `PushTokensController` with the same identity-resolution logic as task 9.2
    - _Requirements: 12.1, 12.2, 12.3, 12.4_
  - [ ]* 9.4 Write property test for controller identity resolution — UUID `sub` always resolves to `wallet_address` from the `users` table; wallet-address `sub` is used directly
    - **Property 12: Controller Identity Resolution**
    - **Validates: Requirements 12.1, 12.2, 12.3**

- [ ] 10. Implement `AuthContext`, `AuthProvider`, and `useAuth` hook
  - [~] 10.1 Create `src/context/AuthContext.tsx` defining `AuthContextValue` interface and `AuthContext` with `createContext`; export `useAuth()` convenience hook
    - Fields: `authState`, `currentUser`, `error`, `getJwt`, `signup`, `login`, `verifyEmail`, `resendCode`, `logout`
    - `CurrentUser` type: `{ id: string; email: string; emailVerified: boolean; walletAddress: string | null }`
    - _Requirements: 11.1, 11.6_
  - [~] 10.2 Create `src/context/AuthProvider.tsx` implementing `useAuth` logic: AsyncStorage key `@edgemarket/email-jwt`, mount rehydration (load JWT → validate `exp` → call `/api/auth/me` → set `authState`), implement all five action functions, expose `getJwt()`
    - Set `authState = 'loading'` during rehydration; resolve before first render
    - _Requirements: 5.3, 5.4, 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ]* 10.3 Write property test for session restore round trip — storing a non-expired JWT in AsyncStorage and re-mounting the hook should call `/api/auth/me` and set `authState = 'authenticated'`
    - **Property 9: Session Restore Round Trip**
    - **Validates: Requirements 5.3, 11.3**
  - [ ]* 10.4 Write property test for logout clears all state — after `logout()`, `authState === 'unauthenticated'`, `currentUser === null`, and AsyncStorage has no `@edgemarket/email-jwt` entry
    - **Property 10: Logout Clears All State**
    - **Validates: Requirements 6.1, 6.2**

- [ ] 11. Implement `AuthGuard` and `AuthNavigator`
  - [~] 11.1 Create `src/navigation/AuthNavigator.tsx` as a `createNativeStackNavigator` with screens: `Login`, `Signup`, `VerifyEmail` (param: `{ email: string }`)
    - _Requirements: 7.2_
  - [~] 11.2 Create `src/navigation/AuthGuard.tsx`: renders `<LoadingScreen />` when `authState === 'loading'`, `<RootNavigator />` when `'authenticated'`, `<AuthNavigator />` when `'unauthenticated'`
    - _Requirements: 7.1, 7.4, 7.5_
  - [ ]* 11.3 Write property test for AuthGuard routing invariant — for each of the three `authState` values the guard renders the correct navigator (no undefined render)
    - **Property 11: Auth Guard Routing Invariant**
    - **Validates: Requirements 7.1, 7.5**

- [ ] 12. Implement `SignupScreen`, `LoginScreen`, and `VerifyEmailScreen`
  - [~] 12.1 Create `src/screens/SignupScreen.tsx`: email + password inputs (password `secureTextEntry`), "Create Account" button calling `signup()`, loading state, error display for 400/409, link to `LoginScreen`; navigate to `VerifyEmail` on 201
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [~] 12.2 Create `src/screens/LoginScreen.tsx`: email + password inputs (password `secureTextEntry`), "Sign In" button calling `login()`, loading state, 401 error message, 403 path with "Resend Code" button navigating to `VerifyEmail`, link to `SignupScreen`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [~] 12.3 Create `src/screens/VerifyEmailScreen.tsx`: display email from nav params, 6-digit numeric input, "Verify" button calling `verifyEmail()`, loading state, error messages for 400; "Resend Code" button calling `resendCode()` with 429 and 200 messages
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [ ] 13. Wire `AuthProvider` and `AuthGuard` into `App.tsx`
  - [~] 13.1 Wrap `NavigationContainer` with `<AuthProvider>` and replace `<RootNavigator />` with `<AuthGuard />` in `App.tsx`
    - _Requirements: 7.1, 11.6_

- [~] 14. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Wire `useAuth` into existing hooks that call protected endpoints
  - [~] 15.1 Update `useFollowing.ts` to call `setFollowingAuth` with `getJwt` from `useAuth` (in addition to the existing `useWalletAuth`-based wiring in `ProfileScreen`), or update `ProfileScreen` to use the email-auth JWT when wallet-auth JWT is absent
    - _Requirements: 12.1_
  - [~] 15.2 Update `usePaperTrades.ts` to accept `getJwt` from `useAuth` in addition to (or instead of) `useWalletAuth`
    - _Requirements: 12.1_

- [~] 16. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP.
- All property tests use jqwik (server) and fast-check (client); minimum 100 iterations each.
- The existing wallet-signature-auth flow (useWalletAuth, TwoStepConnectModal, AuthController, AuthServiceImpl) is unchanged. Wallet-link remains a post-login action on ProfileScreen.
- The `AuthFilter` change in task 9.1 is additive — one string added to the `PROTECTED` set. No existing wallet-auth flows are affected.
- BCrypt cost factor 10 means ~100ms per hash on modern hardware — acceptable for auth endpoints.
- SendGrid is async; if `SENDGRID_API_KEY` is absent, `SendGridEmailService` should log a WARN and skip the send rather than crashing.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "2.2", "3.1", "3.2"] },
    { "id": 1, "tasks": ["4.1", "5.1", "6.1"] },
    { "id": 2, "tasks": ["4.2", "6.2", "6.4", "6.7", "6.9", "6.10"] },
    { "id": 3, "tasks": ["6.3", "6.5", "6.6", "6.8", "6.11", "6.12", "7.1"] },
    { "id": 4, "tasks": ["9.1", "9.2", "9.3", "10.1"] },
    { "id": 5, "tasks": ["9.4", "10.2", "11.1"] },
    { "id": 6, "tasks": ["10.3", "10.4", "11.2", "12.1", "12.2", "12.3"] },
    { "id": 7, "tasks": ["11.3", "13.1"] },
    { "id": 8, "tasks": ["15.1", "15.2"] }
  ]
}
```
