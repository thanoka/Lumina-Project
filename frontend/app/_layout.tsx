import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen
        name="simulator"
        options={{
          headerShown: true,
          headerTitle: '🧪 Simulator',
          headerStyle: { backgroundColor: '#0D1117' },
          headerTintColor: '#F0F6FC',
          presentation: 'modal',
        }}
      />
      <Stack.Screen
        name="sound"
        options={{
          headerShown: true,
          headerTitle: "🔊 Sound",
          headerStyle: { backgroundColor: "#0D1117" },
          headerTintColor: "#F0F6FC",
          presentation: "modal",
        }}
      />
    </Stack>
  );
}
