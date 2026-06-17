/**
 * Low-level Expo push sender. Wraps `expo-server-sdk`: filters invalid tokens,
 * chunks, sends, and reports tokens that should be pruned (DeviceNotRegistered).
 *
 * Expo push works with or without `EXPO_ACCESS_TOKEN` — the token adds enhanced
 * security and higher rate limits. We read it once at module load (mirroring the
 * email/SMS channel convention) and pass it when present.
 */

import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';

const accessToken = process.env.EXPO_ACCESS_TOKEN;
const expo = new Expo(accessToken ? { accessToken } : undefined);

export interface ExpoSendResult {
  /** Number of accepted (ticket status 'ok') messages. */
  sent: number;
  /** Tokens the server should delete (no longer registered). */
  invalidTokens: string[];
}

/**
 * Send one message to many Expo tokens. Returns dead tokens to prune.
 * Never throws — failures are logged per chunk.
 */
export async function sendExpoPush(
  tokens: string[],
  message: Omit<ExpoPushMessage, 'to'>,
): Promise<ExpoSendResult> {
  const valid = Array.from(new Set(tokens)).filter((token) => Expo.isExpoPushToken(token));
  if (valid.length === 0) return { sent: 0, invalidTokens: [] };

  const messages: ExpoPushMessage[] = valid.map((to) => ({ ...message, to }));
  const invalidTokens: string[] = [];
  let sent = 0;

  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.forEach((ticket: ExpoPushTicket, index) => {
        if (ticket.status === 'ok') {
          sent += 1;
          return;
        }
        // status === 'error'
        const to = chunk[index]?.to;
        if (ticket.details?.error === 'DeviceNotRegistered' && typeof to === 'string') {
          invalidTokens.push(to);
        }
      });
    } catch (err) {
      console.error('[expo-push] send chunk failed', err);
    }
  }

  return { sent, invalidTokens };
}
