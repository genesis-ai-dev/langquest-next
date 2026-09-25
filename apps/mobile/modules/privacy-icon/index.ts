import { requireOptionalNativeModule } from 'expo-modules-core';
export const privacyIcon = requireOptionalNativeModule<{
  isSupported(): boolean;
  setDisguised(enabled: boolean): Promise<void>;
}>('PrivacyIcon');
