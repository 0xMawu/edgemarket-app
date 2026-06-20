import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Trophy, Star, User, Zap, Compass } from 'lucide-react-native';
import { LeaderboardScreen } from '../screens/LeaderboardScreen';
import { FollowingScreen } from '../screens/FollowingScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { SignalFeedScreen } from '../screens/SignalFeedScreen';
import { DiscoverScreen } from '../screens/DiscoverScreen';
import { useFollowing } from '../hooks/useFollowing';
import { colors } from '../theme/colors';
import { fonts } from '../theme/fonts';
import { View, Text, StyleSheet } from 'react-native';

// Phase 4: simplified from 6 tabs to 5. "All" and "Top" were merged into a
// single "Leaderboard" tab (see LeaderboardScreen.tsx).
export type RootTabParamList = {
  Leaderboard: undefined;
  Following: undefined;
  Signals: undefined;
  Discover: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

function FollowingTabIcon({ color, size }: { color: string; size: number }) {
  const { followingIds } = useFollowing();
  return (
    <View>
      <Star color={color} size={size} />
      {followingIds.length > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{followingIds.length}</Text>
        </View>
      )}
    </View>
  );
}

export function RootNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.purple,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.4)',
        tabBarStyle: {
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 16,
          height: 70,
          borderRadius: 20,
          backgroundColor: colors.tabBar,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 10 },
      }}
    >
      <Tab.Screen
        name="Leaderboard"
        component={LeaderboardScreen}
        options={{
          tabBarLabel: 'Leaderboard',
          tabBarIcon: ({ color, size }) => <Trophy color={color} size={size ?? 22} />,
        }}
      />
      <Tab.Screen
        name="Following"
        component={FollowingScreen}
        options={{
          tabBarLabel: 'Following',
          tabBarIcon: ({ color, size }) => (
            <FollowingTabIcon color={color} size={size ?? 22} />
          ),
        }}
      />
      <Tab.Screen
        name="Signals"
        component={SignalFeedScreen}
        options={{
          tabBarLabel: 'Signals',
          tabBarIcon: ({ color, size }) => <Zap color={color} size={size ?? 22} />,
        }}
      />
      <Tab.Screen
        name="Discover"
        component={DiscoverScreen}
        options={{
          tabBarLabel: 'Discover',
          tabBarIcon: ({ color, size }) => <Compass color={color} size={size ?? 22} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <User color={color} size={size ?? 22} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    backgroundColor: colors.purple,
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9, fontFamily: fonts.bold, fontWeight: '700' },
});
