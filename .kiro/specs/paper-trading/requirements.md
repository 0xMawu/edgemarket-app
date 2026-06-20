# Requirements Document

## Introduction

The Paper Trading feature lets EdgeMarket users simulate copy-trading by mirroring a followed
wallet's current open positions without risking real funds. When a user activates paper trading
against a target wallet, the system snapshots that wallet's open Polymarket positions and
records them as paper trades. Live P&L is then computed by comparing the entry price at
snapshot time against the current market price from the Polymarket data API. The simulated
portfolio is surfaced as a card on the Profile screen.

The feature adds one new database table (`paper_trades`), two new REST endpoints
(`POST /api/paper-trades` and `GET /api/paper-trades/{userAddress}`), and a
`PaperTradeCard` React Native component on `ProfileScreen`.

---

## Glossary

- **Paper_Trade_Service**: The Spring Boot service layer responsible for creating, storing, and enriching paper trade records.
- **Paper_Trade_Controller**: The Spring Boot REST controller that exposes the paper trading endpoints and enforces JWT authentication.
- **Paper_Trade_Repository**: The JDBC-backed data access layer that reads and writes to the `paper_trades` table in PostgreSQL.
- **Polymarket_API**: The external data API at `https://data-api.polymarket.com` used to fetch a wallet's current open positions and live market prices.
- **PaperTradeCard**: The React Native UI component rendered on `ProfileScreen` that displays the user's simulated portfolio with live P&L.
- **usePaperTrades**: The React Native hook that calls `GET /api/paper-trades/{userAddress}` and exposes the portfolio data and loading state to `PaperTradeCard`.
- **Target_Wallet**: The followed trader's wallet address whose open positions are being mirrored.
- **Simulated_Portfolio**: The collection of paper trades belonging to one user, enriched with live prices to produce current P&L figures.
- **Entry_Price**: The `avgPrice` value recorded from the Polymarket position at the moment the paper trade is created.
- **Shares**: The `size` value recorded from the Polymarket position at the moment the paper trade is created.
- **Live_Price**: The current `curPrice` fetched from the Polymarket API at query time, used to calculate unrealised P&L.
- **JWT**: The JSON Web Token issued by the existing SIWE authentication flow, required for mutating paper trade data.
- **SIWE**: Sign-In With Ethereum — the existing wallet authentication mechanism.

---

## Requirements

### Requirement 1: Paper Trades Database Table

**User Story:** As a backend developer, I want a dedicated table to persist paper trade records, so that simulated positions survive app restarts and can be queried efficiently.

#### Acceptance Criteria

1. THE Paper_Trade_Repository SHALL store each paper trade with the fields: `id` (serial primary key), `user_address` (text NOT NULL), `target_address` (text NOT NULL), `market_id` (text NOT NULL), `entry_price` (numeric NOT NULL), `shares` (numeric NOT NULL), and `created_at` (timestamptz NOT NULL DEFAULT NOW()).
2. THE Paper_Trade_Repository SHALL enforce a unique constraint on `(user_address, target_address, market_id)` so that a user cannot hold duplicate paper positions in the same market for the same target wallet; IF a duplicate insert is attempted, THE system SHALL reject it without corrupting existing data.
3. THE Paper_Trade_Repository SHALL enforce that `entry_price` and `shares` are greater than zero; IF either value is zero or negative, THE system SHALL reject the record.
4. THE Paper_Trade_Repository SHALL maintain an index on `user_address` to support efficient lookup of all paper trades belonging to a single user.
5. WHEN the Spring Boot application starts, THE Paper_Trade_Repository SHALL create the `paper_trades` table if it does not already exist, without dropping existing data.

---

### Requirement 2: Copy Target Wallet's Positions (POST /api/paper-trades)

**User Story:** As an authenticated user, I want to copy a followed wallet's current open positions into my paper portfolio, so that I can simulate trading alongside that trader.

#### Acceptance Criteria

1. WHEN a POST request is received at `/api/paper-trades` with a valid JWT and a JSON body containing `userAddress` and `targetAddress`, THE Paper_Trade_Controller SHALL verify that the JWT subject matches `userAddress` (case-insensitive) before processing the request.
2. IF the JWT is absent, malformed, or invalid on a POST `/api/paper-trades` request, THEN THE Paper_Trade_Controller SHALL return HTTP 401 with a JSON body containing an `error` field.
3. IF the JWT subject does not match `userAddress` (case-insensitive), THEN THE Paper_Trade_Controller SHALL return HTTP 403 with a JSON body containing an `error` field.
4. IF `userAddress` or `targetAddress` is absent or does not match `^0x[0-9a-fA-F]{40}$`, THEN THE Paper_Trade_Controller SHALL return HTTP 400 with a JSON body containing an `error` field describing which field(s) failed validation.
5. IF `userAddress` does not follow `targetAddress` in the existing `follows` table, THEN THE Paper_Trade_Controller SHALL return HTTP 422 with a JSON body containing an `error` field indicating the target wallet is not followed.
6. WHEN the request is authenticated and validated, THE Paper_Trade_Service SHALL fetch the current open positions of `targetAddress` from `https://data-api.polymarket.com/positions?user={targetAddress}`.
7. IF the Polymarket_API returns a non-2xx response or a network error, THEN THE Paper_Trade_Service SHALL return HTTP 502 with a JSON body containing an `error` field and the upstream HTTP status code where available.
8. IF the Polymarket_API returns an empty positions array for `targetAddress`, THEN THE Paper_Trade_Controller SHALL return HTTP 422 with a JSON body containing an `error` field indicating that the target wallet has no open positions to copy.
9. WHEN open positions are retrieved from the Polymarket_API, THE Paper_Trade_Service SHALL insert one paper trade record per position using `conditionId` as `market_id`, `avgPrice` as `entry_price`, and `size` as `shares`.
10. WHEN a paper trade record already exists for the same `(user_address, target_address, market_id)`, THE Paper_Trade_Service SHALL skip that position without error, preserving the original `entry_price` and `created_at`.
11. IF some insertions succeed and others fail due to a database error, THEN THE Paper_Trade_Controller SHALL return HTTP 500 with a JSON body containing an `error` field; no partial state is committed.
12. WHEN all insertions complete without database error, THE Paper_Trade_Controller SHALL return HTTP 201 with a JSON body containing `created` (count of newly inserted records) and `skipped` (count of positions skipped due to existing records).

---

### Requirement 3: Retrieve Simulated Portfolio with Live P&L (GET /api/paper-trades/{userAddress})

**User Story:** As a user, I want to retrieve my simulated portfolio with up-to-date profit and loss figures, so that I can evaluate whether mirroring a trader is worthwhile.

#### Acceptance Criteria

1. WHEN a GET request is received at `/api/paper-trades/{userAddress}`, THE Paper_Trade_Controller SHALL return the caller's paper trades enriched with live prices, regardless of whether a JWT is present.
2. IF the `userAddress` path parameter does not match `^0x[0-9a-fA-F]{40}$`, THEN THE Paper_Trade_Controller SHALL return HTTP 400 with a JSON body containing an `error` field before querying the database.
3. IF `userAddress` resolves to zero paper trade records, THEN THE Paper_Trade_Controller SHALL return HTTP 200 with an empty `trades` array and zero-value `portfolioSummary` fields.
4. WHEN paper trades exist for `userAddress`, THE Paper_Trade_Service SHALL fetch the current price for each distinct `market_id` from `https://data-api.polymarket.com/positions?user={targetAddress}` using the stored `target_address` per trade.
5. WHEN `livePrice` is available and `entryPrice` is greater than zero, THE Paper_Trade_Service SHALL compute `unrealisedPnl` as `(livePrice - entryPrice) × shares`, rounded to two decimal places.
6. WHEN `livePrice` is available and `entryPrice` is greater than zero, THE Paper_Trade_Service SHALL compute `pnlPercentage` as `((livePrice - entryPrice) / entryPrice) × 100`, rounded to two decimal places.
7. IF `entryPrice` is zero, THEN `pnlPercentage` SHALL be set to `null` to prevent division by zero.
8. IF the Polymarket_API is unreachable or returns no price data for a `market_id`, THEN THE Paper_Trade_Service SHALL include the trade in the response with `livePrice: null`, `unrealisedPnl: null`, and `pnlPercentage: null`, rather than failing the entire request.
9. WHEN all trades are enriched, THE Paper_Trade_Service SHALL aggregate a `portfolioSummary` containing: `totalTrades` (integer count), `totalUnrealisedPnl` (sum of non-null `unrealisedPnl` values rounded to two decimal places), and `groupedByTarget` (a map of `targetAddress` to its list of trades).
10. THE Paper_Trade_Controller SHALL return the enriched portfolio response within 3 000 milliseconds for portfolios containing up to 50 paper trades.

---

### Requirement 4: JWT Authentication Enforcement

**User Story:** As a security-conscious developer, I want all paper trade write operations to require a valid JWT, so that users cannot copy positions on behalf of other wallets.

#### Acceptance Criteria

1. WHEN a POST request arrives at `/api/paper-trades`, THE Paper_Trade_Controller SHALL extract and validate the JWT from the `Authorization: Bearer <token>` header using the existing `AuthFilter` before any business logic executes.
2. IF the `Authorization` header is absent, malformed, contains an expired JWT, or contains a JWT with an invalid signature, THEN THE Paper_Trade_Controller SHALL return HTTP 401 with a JSON body `{"error": "Unauthorized"}`.
3. IF the `userAddress` field is present in the request body and the JWT subject (lower-cased) does not equal `userAddress` (lower-cased), THEN THE Paper_Trade_Controller SHALL return HTTP 403 with a JSON body `{"error": "Forbidden"}`.
4. IF the `userAddress` field is absent from the request body, THEN THE Paper_Trade_Controller SHALL return HTTP 400 before performing the JWT subject comparison.
5. WHEN a GET request is received at `/api/paper-trades/{userAddress}`, THE Paper_Trade_Controller SHALL process the request without requiring an `Authorization` header.

---

### Requirement 5: Frontend Hook — usePaperTrades

**User Story:** As a frontend developer, I want a React Native hook that fetches and manages the paper trading portfolio, so that UI components can display live P&L without managing network logic themselves.

#### Acceptance Criteria

1. THE `usePaperTrades` hook SHALL accept `userAddress: string | null` and return `{ portfolio: Portfolio | null, loading: boolean, error: string | null, copyPositions: (targetAddress: string) => Promise<void>, refresh: () => void }`.
2. WHEN `userAddress` is non-null, THE `usePaperTrades` hook SHALL call `GET /api/paper-trades/{userAddress}` on mount and populate `portfolio` with the response data; `loading` SHALL be `true` during the request and `false` after.
3. WHEN `userAddress` is null, THE `usePaperTrades` hook SHALL set `loading` to `false`, `portfolio` to `null`, and SHALL NOT issue any network requests.
4. WHEN `copyPositions(targetAddress)` is called, THE `usePaperTrades` hook SHALL set `loading` to `true`, issue a POST to `/api/paper-trades` with body `{ userAddress, targetAddress }` and the `Authorization: Bearer <jwt>` header from `useWalletAuth`, and set `loading` to `false` when the request settles.
5. IF the POST request returns HTTP 401 or 403, THEN THE `usePaperTrades` hook SHALL invoke the `onUnauthorized` callback from `useWalletAuth` and SHALL NOT set `error`.
6. WHEN `copyPositions` receives a 2xx response, THE `usePaperTrades` hook SHALL call `refresh` to reload the portfolio data.
7. IF the network request fails or the server returns a non-2xx, non-401, non-403 status, THEN THE `usePaperTrades` hook SHALL set `error` to a human-readable message string of at most 150 characters and SHALL NOT throw an unhandled exception.

---

### Requirement 6: PaperTradeCard UI Component

**User Story:** As a user, I want to see my simulated portfolio on my Profile screen, so that I can monitor the performance of copy-traded positions at a glance.

#### Acceptance Criteria

1. THE `PaperTradeCard` SHALL accept a `followedTraders: string[]` prop containing the addresses of traders the user follows, and SHALL be rendered on `ProfileScreen` below the Portfolio Analytics card when the user's wallet is connected.
2. WHILE `loading` is `true`, THE `PaperTradeCard` SHALL display an `ActivityIndicator` in place of portfolio data.
3. WHEN `portfolio` contains zero trades, THE `PaperTradeCard` SHALL display an empty-state message and a "Copy Positions" button for each address in `followedTraders`.
4. WHEN `portfolio` contains one or more trades, THE `PaperTradeCard` SHALL display a summary row showing `totalUnrealisedPnl` formatted to two decimal places as a USD string and `totalTrades`, followed by a scrollable list of individual trade rows.
5. WHEN a trade row is rendered, THE `PaperTradeCard` SHALL display the market name, outcome, entry price (formatted to four decimal places), live price (formatted to four decimal places, or "—" when `livePrice` is null), and `unrealisedPnl` formatted as a USD string to two decimal places with a leading "+" for positive values.
6. WHEN `unrealisedPnl` is positive or zero, THE `PaperTradeCard` SHALL render the P&L value using `colors.green`. WHEN `unrealisedPnl` is negative, THE `PaperTradeCard` SHALL render the P&L value using `colors.red`.
7. THE `PaperTradeCard` SHALL include a "Copy Positions" button for each address in `followedTraders` in both the empty-state and non-empty-state views that, when pressed, invokes `copyPositions(targetAddress)`.
8. IF `error` is non-null, THEN THE `PaperTradeCard` SHALL display the error message text and a "Retry" button that calls `refresh`.
9. THE `PaperTradeCard` SHALL use `colors.card` as background colour, 16 px border radius, a 1 px border in `colors.cardBorder`, and 16 px padding, consistent with existing card components.

---

### Requirement 7: Input Validation and Error Handling

**User Story:** As a developer, I want all inputs to be validated and all error paths to return descriptive responses, so that client developers can surface meaningful feedback to users.

#### Acceptance Criteria

1. THE Paper_Trade_Controller SHALL validate that `userAddress` and `targetAddress` each match `^0x[0-9a-fA-F]{40}$` on every write request.
2. IF one or both addresses fail the format check, THEN THE Paper_Trade_Controller SHALL return HTTP 400 with a JSON body containing an `error` field that names the invalid field(s).
3. THE Paper_Trade_Service SHALL lower-case all wallet addresses before any database read or write operation.
4. IF a database error occurs during any operation, THEN THE Paper_Trade_Controller SHALL return HTTP 500 with a JSON body `{"error": "Internal server error"}` and SHALL log the exception at ERROR level.
5. THE Paper_Trade_Service SHALL not propagate raw database exception messages or stack traces in any HTTP response body.

---

### Requirement 8: Data Consistency — Round-Trip Integrity

**User Story:** As a QA engineer, I want the data written during position copying to be faithfully returned on subsequent reads, so that the portfolio display is accurate.

#### Acceptance Criteria

1. WHEN `copyPositions` succeeds for a `(userAddress, targetAddress)` pair, THE `GET /api/paper-trades/{userAddress}` response SHALL contain a trade record for each inserted position with `entryPrice` and `shares` values identical to those recorded at insert time.
2. WHEN `copyPositions` is called a second time for the same `(userAddress, targetAddress)` pair, THE Paper_Trade_Service SHALL not create duplicate records; the `created` count in the response SHALL be zero and `skipped` SHALL equal the number of positions in the target wallet.
3. WHEN two users concurrently call `copyPositions` for the same `targetAddress`, THE Paper_Trade_Service SHALL record independent paper trade rows for each user such that each user's `user_address` column contains only their own address.
