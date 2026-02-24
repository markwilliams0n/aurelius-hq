import { getConfig, updateConfig } from '@/lib/config';

const INITIAL_PREFERENCES = [
  "Archive notifications from GitHub, Figma, Slack, Airtable, Linear, Vercel, Railway, Neon, Sentry, Google Alerts, and Google Search Console",
  "Archive finance-related automated emails from Venmo, PayPal, Stripe, and QuickBooks",
  "Archive calendar invitations, updates, and cancellations",
  "Archive newsletters from Substack and Beehiiv",
  "Always surface direct personal emails from people I've met or work with",
  "If someone new reaches out directly, treat it as needing my attention",
];

/**
 * Seeds the email:preferences config with initial preferences derived from
 * the existing triage rules. No-ops if preferences already exist.
 * @returns true if preferences were seeded, false if they already existed
 */
export async function seedEmailPreferences(): Promise<boolean> {
  const existing = await getConfig('email:preferences');
  if (existing) return false;

  await updateConfig('email:preferences', JSON.stringify(INITIAL_PREFERENCES), 'aurelius');
  return true;
}
