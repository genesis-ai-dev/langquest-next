/** Whether a connection (expo-network's `NetworkStateType`) is not metered: a phone's data plan is the thing to spare. */
export function isUnmetered(type: string | undefined): boolean {
  return type === 'WIFI' || type === 'ETHERNET';
}
