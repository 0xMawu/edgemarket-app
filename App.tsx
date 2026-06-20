import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { View, Text } from "react-native";
import { RootNavigator } from "./src/navigation/RootNavigator";

/**
 * Font loading via expo-google-fonts/inter.
 *
 * Install with:
 *   npx expo install expo-font @expo-google-fonts/inter
 *
 * Once installed, uncomment the block below and remove the fallback export.
 */

// ── UNCOMMENT AFTER INSTALLING expo-font + @expo-google-fonts/inter ─────────
//
// import {
//   useFonts,
//   Inter_400Regular,
//   Inter_500Medium,
//   Inter_600SemiBold,
//   Inter_700Bold,
// } from "@expo-google-fonts/inter";
// import * as SplashScreen from "expo-splash-screen";
// import { useEffect } from "react";
//
// SplashScreen.preventAutoHideAsync();
//
// export default function App() {
//   const [fontsLoaded, fontError] = useFonts({
//     Inter_400Regular,
//     Inter_500Medium,
//     Inter_600SemiBold,
//     Inter_700Bold,
//   });
//
//   useEffect(() => {
//     if (fontsLoaded || fontError) SplashScreen.hideAsync();
//   }, [fontsLoaded, fontError]);
//
//   if (!fontsLoaded && !fontError) return null;
//
//   return (
//     <SafeAreaProvider>
//       <StatusBar style="light" />
//       <NavigationContainer>
//         <RootNavigator />
//       </NavigationContainer>
//     </SafeAreaProvider>
//   );
// }
// ────────────────────────────────────────────────────────────────────────────

// Fallback export (uses system fonts until expo-google-fonts/inter is installed)
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer>
        <RootNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
