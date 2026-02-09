/**
 * One-time script: retroactively archive Gmail threads that are
 * archived in triage but still in Gmail inbox.
 *
 * Usage: npx tsx scripts/retroactive-gmail-archive.ts [--dry-run]
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '..', '.env.local') });

import postgres from 'postgres';
import { google } from 'googleapis';

const DRY_RUN = process.argv.includes('--dry-run');

async function getGmailClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH!,
    scopes: ['https://www.googleapis.com/auth/gmail.modify'],
    clientOptions: {
      subject: process.env.GOOGLE_IMPERSONATE_EMAIL!,
    },
  });
  return google.gmail({ version: 'v1', auth });
}

async function run() {
  const client = postgres(process.env.DATABASE_URL!);
  const gmail = await getGmailClient();

  // Find all Gmail items that are archived in triage
  const archivedItems = await client`
    SELECT id, external_id, subject
    FROM inbox_items
    WHERE connector = 'gmail'
      AND status = 'archived'
      AND external_id IS NOT NULL
    ORDER BY updated_at DESC
  `;

  console.log(`Found ${archivedItems.length} archived Gmail items in triage`);
  if (DRY_RUN) console.log('DRY RUN — no changes will be made');

  let archived = 0;
  let alreadyArchived = 0;
  let errors = 0;

  for (const item of archivedItems) {
    const threadId = item.external_id;
    try {
      // Check if thread still has INBOX label
      const thread = await gmail.users.threads.get({
        userId: 'me',
        id: threadId,
        format: 'minimal',
      });

      const hasInbox = thread.data.messages?.some(msg =>
        msg.labelIds?.includes('INBOX')
      );

      if (!hasInbox) {
        alreadyArchived++;
        continue;
      }

      console.log(`  Archiving: ${item.subject?.slice(0, 60)} (${threadId})`);

      if (!DRY_RUN) {
        await gmail.users.threads.modify({
          userId: 'me',
          id: threadId,
          requestBody: {
            removeLabelIds: ['INBOX'],
          },
        });
      }
      archived++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 50));
    } catch (error: any) {
      if (error?.code === 404) {
        // Thread was deleted from Gmail
        alreadyArchived++;
      } else {
        console.error(`  Error on ${threadId}:`, error?.message || error);
        errors++;
      }
    }
  }

  console.log(`\nResults:`);
  console.log(`  Archived in Gmail: ${archived}`);
  console.log(`  Already archived:  ${alreadyArchived}`);
  console.log(`  Errors:            ${errors}`);

  await client.end();
}

run().catch(e => { console.error(e); process.exit(1); });
