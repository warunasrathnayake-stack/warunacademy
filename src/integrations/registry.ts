import { ApiError } from '../platform/errors.js';

// Deliberately no HTTP transport, OAuth client, scheduler or enable-by-env switch in this phase.
export const capabilities = {
  meta: ['lead.receive', 'insights.read'],
  facebook: ['page.publish'],
  instagram: ['media.publish'],
  'meta-ads': ['insights.read', 'campaign.change'],
  youtube: ['video.upload'],
  tiktok: ['video.publish'],
  whatsapp: ['message.receive', 'template.send'],
  sms: ['template.send', 'delivery.receive'],
  payments: ['checkout.create', 'settlement.receive'],
  openai: ['answer.grounded'],
  'live-class': ['meeting.create', 'recording.receive'],
  smtp: ['mail.send'],
  analytics: ['aggregate.record'],
} as const;
// Only providers with a planned inbound event flow get a reserved callback route.
export const webhookProviders = ['meta', 'whatsapp', 'sms', 'payments', 'live-class'] as const;
export const hasWebhook = (name: string) => webhookProviders.some((p) => p === name);
export type Provider = keyof typeof capabilities;
export interface IntegrationAdapter<P extends Provider> {
  provider: P;
  status: 'disabled' | 'sandbox' | 'approved';
  execute(
    operation: (typeof capabilities)[P][number],
    input: Readonly<Record<string, unknown>>,
  ): Promise<{ externalRef: string }>;
  verifyWebhook(
    raw: Uint8Array,
    headers: Headers,
  ): Promise<{ eventRef: string; kind: string; accountRef: string }>;
  refresh(): Promise<{ expiresAt: string | null }>;
}
export const disabled = () => new ApiError(503, 'integration_disabled');
export function adapterFor<P extends Provider>(provider: P): IntegrationAdapter<P> {
  const stop = async (): Promise<never> => {
    throw disabled();
  };
  return { provider, status: 'disabled', execute: stop, verifyWebhook: stop, refresh: stop };
}
export function isProvider(name: string): name is Provider {
  return Object.hasOwn(capabilities, name);
}
