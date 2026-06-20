# EdgeMarket Spring Boot Server

Drop-in Spring Boot replacement for the original Express/TypeScript backend.
Port: **8080** (matches the Android app's `10.0.2.2:8080` emulator URL).

> **Phase 6:** This server now fully replaces the old `server/` Node.js
> proxy, which has been removed from the project. All traders/markets
> caching, follows, push-token, and trade-watcher functionality lives
> here. The mobile app no longer needs a port-3001 service.

## Requirements
- Java 17+
- Maven 3.8+
- PostgreSQL (or Neon)

## Configuration

`application.properties` is pre-configured to connect to a Neon Postgres
database, but the password is **not** stored in the file. Set it as an
environment variable before starting the server:

```bash
# Linux/macOS/Git Bash
export DB_PASSWORD="your-neon-password"

# Windows PowerShell
$env:DB_PASSWORD="your-neon-password"
```

⚠️ If you don't have the current password, get it from Neon Dashboard →
Settings → Roles (or reset it: Settings → Roles → Reset Password).

## Run locally

```bash
cd spring-server

# Make sure DB_PASSWORD is set (see Configuration above), then:
./mvnw spring-boot:run

# Or override the connection string/profile entirely:
./mvnw spring-boot:run -Dspring-boot.run.profiles=neon \
  -Dspring.datasource.url="jdbc:postgresql://ep-xxx.neon.tech/neondb?sslmode=require" \
  -Dspring.datasource.username=neondb_owner
```

## Build JAR

```bash
./mvnw clean package -DskipTests
DB_PASSWORD="your-neon-password" java -jar target/edgemarket-server-1.0.0.jar
```

## Endpoints (identical to original Express server)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /api/traders | Polymarket leaderboard (60s cache) |
| GET | /api/markets | Active markets (60s cache) |
| GET | /api/follows/:walletAddress | Get follows for a user |
| POST | /api/follows | Follow { userAddress, targetAddress } |
| DELETE | /api/follows | Unfollow { userAddress, targetAddress } |
| POST | /api/push-tokens | Register { userAddress, pushToken } |
| DELETE | /api/push-tokens | Remove { userAddress } |

## Trade Watcher
Runs automatically on startup (5s delay), repeats every 60s (configurable via `watcher.interval.ms`).
Fetches new trades from Polymarket for followed addresses and sends Expo push notifications.
