export const REMOVE_ADS_PRODUCT_ID = 'hauskauf_remove_ads';
export const GOOGLE_TEST_BANNER_ID = 'ca-app-pub-3940256099942544/6300978111';
export const BANNER_AD_UNIT_ID = __DEV__
  ? GOOGLE_TEST_BANNER_ID
  : (process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID || '').trim();
