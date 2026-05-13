import { Linking, Platform } from 'react-native';

export async function openUrl(url: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  const supported = await Linking.canOpenURL(url);
  if (!supported) throw new Error(`Cannot open URL: ${url}`);
  await Linking.openURL(url);
}
