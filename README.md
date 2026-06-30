# EdgeMarket App (React Native + TypeScript)
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


## Project structure

```
App.tsx                       # Entry pointnavigation
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
## Notes

- Icons use `lucide-react-native` (same icon set as the original web
  design, just the React Native package).
- The gradient background uses `expo-linear-gradient`.
- Navigation uses `@react-navigation/bottom-tabs`, matching the 4-tab
  layout (Rankings, Signals, Discover, Profile) from the original
  `Layout.tsx`.
- All styling uses React Native `StyleSheet`
  to keep the dependency list minimal and easy to reason about.
