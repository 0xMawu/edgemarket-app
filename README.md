# Wallet Ranking App (React Native + TypeScript)

> **Phase 6 update:** The Node.js proxy server (`server/`, port 3001) has
> been removed. Its responsibilities (`/api/traders`, `/api/markets`
> caching, `/api/follows`, `/api/push-tokens`, and the trade-watcher push
> notification worker) are now all handled by the Spring Boot backend in
> `spring-server/` (port 8080). The app now requires only **two** running
> services instead of three:
>
> | Service | Folder | Port | Command |
> |---------|--------|------|---------|
> | Spring Boot API | `spring-server/` | 8080 | `./mvnw spring-boot:run` |
> | Expo frontend | root | 8081 | `npx expo start --android` |
>
> Run both with `./start.sh`, or start them individually as shown above.
> See `spring-server/README.md` for backend setup (Java 21, Neon Postgres).
>
> All frontend API URLs are centralized in `src/config/api.ts` — update
> `ANDROID_HOST` there if your dev machine's LAN IP changes (e.g. for
> testing on a physical device).

This is a converted React Native + Expo + TypeScript version of the
"Mobile Wallet Ranking App" web design. It has 4 screens with bottom
tab navigation, matching the original UI:

- **Rankings** – top wallets leaderboard
- **Signals** (Copy Trading) – live trade feed with "Copy" buttons
- **Discover** – trending tokens + search bar
- **Profile** – user profile, performance stats, menu, logout

All data currently comes from `src/data/mockData.ts` (fake/dummy data).
This is intentionally simple so it's easy to wire up to a real backend.

## Project structure

```
App.tsx                       # Entry point, sets up navigation
src/
  navigation/RootNavigator.tsx # Bottom tab bar (4 tabs)
  screens/
    RankingsScreen.tsx
    CopyTradingScreen.tsx
    DiscoverScreen.tsx
    ProfileScreen.tsx
  components/Screen.tsx        # Shared gradient background wrapper
  theme/colors.ts               # All colors in one place
  data/mockData.ts              # Mock data + TypeScript interfaces
```

---

## 1. Running it locally (before Android Studio)

The fastest way to see it on your phone or an emulator is **Expo**:

```bash
npm install
npx expo start
```

This opens a QR code. Scan it with the **Expo Go** app (iOS/Android) to
preview the app instantly on your phone — no Android Studio needed for
day-to-day development.

---

## 2. Running it in Android Studio (emulator)

Since this is an Expo project, you don't need to open it "as a project"
in Android Studio. Instead, Android Studio just provides the **emulator**
(virtual Android phone), and Expo runs your app inside it.

Steps:

1. **Install Android Studio** (https://developer.android.com/studio).
2. Open Android Studio → **More Actions → Virtual Device Manager** →
   create a new device (e.g. Pixel 7, latest Android image) → start it.
   This launches the Android emulator.
3. In your project folder, install dependencies:
   ```bash
   npm install
   ```
4. Start Expo and target Android:
   ```bash
   npx expo start --android
   ```
   Expo will detect the running emulator and install/launch the app
   automatically.

If you later need a **native build** (e.g. to add native modules not
supported by Expo Go), run:
```bash
npx expo prebuild
```
This generates an `android/` folder that you can open directly in
Android Studio as a normal native project.

---

## 3. Developing the backend (with Claude)

The frontend is structured so the backend integration is a small,
isolated change. Here's a suggested plan you can hand to Claude step by
step:

### Step 1 — Define your data model
Look at `src/data/mockData.ts`. The interfaces there
(`WalletItem`, `TradeItem`, `TrendingToken`, plus the `mockUser` and
`mockCopyTradingStats` shapes) are essentially your database schema.
Ask Claude to design a database (e.g. Postgres/Supabase/Firebase) using
these shapes as a starting point.

### Step 2 — Build an API
Ask Claude to create simple REST (or tRPC/GraphQL) endpoints, e.g.:
- `GET /wallets` → list of wallets for the Rankings screen
- `GET /trades` → live trade feed for the Signals screen
- `POST /trades/:id/copy` → mark a trade as "copied" by the user
- `GET /tokens/trending` → trending tokens for Discover
- `GET /me` → current user profile + stats for Profile screen

A good simple stack for a 1-week build: **Node.js + Express +
Supabase/PostgreSQL**, or just **Supabase** directly (it gives you a
database, auth, and auto-generated REST API with very little backend
code).

### Step 3 — Add an API layer to the app
Create a new file `src/api/client.ts` with a small fetch wrapper, e.g.:

```ts
const BASE_URL = "https://your-backend-url.com";

export async function getWallets() {
  const res = await fetch(`${BASE_URL}/wallets`);
  return res.json();
}
```

### Step 4 — Replace mock data with real data
In each screen, replace the static import (e.g.
`import { mockWallets } from "../data/mockData"`) with a `useState` +
`useEffect` that calls your API function and stores the result. The
TypeScript interfaces in `mockData.ts` should match your API responses,
so the JSX/UI code barely changes.

Example pattern:
```ts
const [wallets, setWallets] = useState<WalletItem[]>([]);

useEffect(() => {
  getWallets().then(setWallets);
}, []);
```

### Step 5 — Add authentication
For login/signup (wallet connect or email), Supabase Auth or Firebase
Auth are the quickest options for a 1-week timeline. Once a user is
logged in, use their auth token to fetch their personalized `/me` data
for the Profile screen and to record "copy trade" actions.

### Step 6 — Real-time updates (optional, for Signals feed)
If you want the Signals/Copy Trading feed to update live, consider:
- Supabase Realtime (Postgres changes pushed via websockets), or
- A simple polling `setInterval` that re-fetches `/trades` every few
  seconds (simplest option for a first version).

---

## Notes

- Icons use `lucide-react-native` (same icon set as the original web
  design, just the React Native package).
- The gradient background uses `expo-linear-gradient`.
- Navigation uses `@react-navigation/bottom-tabs`, matching the 4-tab
  layout (Rankings, Signals, Discover, Profile) from the original
  `Layout.tsx`.
- All styling uses React Native `StyleSheet` (no Tailwind/NativeWind),
  to keep the dependency list minimal and easy to reason about.
