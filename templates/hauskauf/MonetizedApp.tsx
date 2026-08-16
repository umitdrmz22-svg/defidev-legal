import React from 'react';
import { Platform, View } from 'react-native';
import App from '../../App';
import {
  HauskaufMonetizationFooter,
  HauskaufMonetizationProvider,
} from './HauskaufMonetization';

export default function MonetizedApp() {
  if (Platform.OS === 'web') return <App />;
  return (
    <HauskaufMonetizationProvider>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <App />
        </View>
        <HauskaufMonetizationFooter />
      </View>
    </HauskaufMonetizationProvider>
  );
}
