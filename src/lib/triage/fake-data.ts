import { NewInboxItem } from "@/lib/db/schema";
import { enrichTriageItem } from "./enrichment";

// Realistic fake people
const PEOPLE = [
  { name: "Sarah Chen", email: "sarah.chen@acme.io", avatar: null, company: "Acme Corp" },
  { name: "James Rodriguez", email: "james@startup.co", avatar: null, company: "Startup Co" },
  { name: "Emily Watson", email: "emily.watson@bigtech.com", avatar: null, company: "BigTech" },
  { name: "Michael Park", email: "m.park@venture.vc", avatar: null, company: "Venture Capital" },
  { name: "Lisa Thompson", email: "lisa@agency.design", avatar: null, company: "Design Agency" },
  { name: "David Kim", email: "dkim@enterprise.io", avatar: null, company: "Enterprise Inc" },
  { name: "Rachel Green", email: "rachel@consulting.biz", avatar: null, company: "Consulting Group" },
  { name: "Alex Martinez", email: "alex@devtools.dev", avatar: null, company: "DevTools" },
  { name: "Jennifer Lee", email: "jlee@finance.co", avatar: null, company: "Finance Co" },
  { name: "Tom Wilson", email: "tom.wilson@media.io", avatar: null, company: "Media Inc" },
];

// Slack channels/users
const SLACK_SOURCES = [
  { channel: "#engineering", user: "Alex Martinez" },
  { channel: "#product", user: "Sarah Chen" },
  { channel: "#general", user: "Tom Wilson" },
  { channel: "@dm", user: "Emily Watson" },
  { channel: "#design", user: "Lisa Thompson" },
  { channel: "#alerts", user: "System Bot" },
];

// Linear projects
const LINEAR_PROJECTS = [
  "Mobile App v2",
  "API Redesign",
  "Dashboard Improvements",
  "Infrastructure",
  "Customer Feedback",
];

// Email templates - realistic business scenarios
const EMAIL_TEMPLATES: Array<{
  subject: string;
  content: string;
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
}> = [
  {
    subject: "Re: Q3 Planning Session - Action Required",
    content: `Hi,

Following up on our Q3 planning discussion. We need to finalize the roadmap by Friday.

Key decisions needed:
- Resource allocation for the new mobile initiative
- Timeline for the API v2 migration
- Budget approval for the design system refresh

Can you review the attached proposal and let me know your thoughts? I'd like to schedule a sync this week if possible.

Best,`,
    priority: "high",
    tags: ["planning", "q3"],
  },
  {
    subject: "Urgent: Production incident - API latency spike",
    content: `ALERT: We're seeing increased API latency across all endpoints.

Current status:
- P95 latency: 2.3s (normal: 200ms)
- Error rate: 3.2%
- Affected: All regions

Investigation in progress. The team is looking at recent deployments as a potential cause.

Will update in 30 minutes.`,
    priority: "urgent",
    tags: ["incident", "production"],
  },
  {
    subject: "Partnership proposal - Integration opportunity",
    content: `Hi there,

I hope this email finds you well. I'm reaching out because I believe there's a great opportunity for our companies to collaborate.

We've built a customer analytics platform that integrates seamlessly with products like yours. Our mutual customers have been asking about a native integration.

Would you be open to a quick call next week to explore this? I can share some data on the potential impact.

Looking forward to hearing from you.`,
    priority: "normal",
    tags: ["partnership", "integration"],
  },
  {
    subject: "Weekly newsletter: Tech roundup",
    content: `This week in tech:

1. AI developments continue to accelerate
2. New framework released with 10x performance gains
3. Major acquisition announced in the cloud space
4. Security vulnerability discovered in popular library

Click here to read more...`,
    priority: "low",
    tags: ["newsletter"],
  },
  {
    subject: "Invoice #INV-2024-0892 - Payment reminder",
    content: `Dear Customer,

This is a friendly reminder that Invoice #INV-2024-0892 for $4,500 is due in 5 days.

Invoice details:
- Service: Professional Services - January 2024
- Amount: $4,500.00
- Due date: February 7, 2024

Please let us know if you have any questions.`,
    priority: "normal",
    tags: ["finance", "invoice"],
  },
  {
    subject: "Feedback on the new feature release",
    content: `Hey team,

Just wanted to share some initial feedback on the feature we shipped last week:

Positives:
- Users love the new dashboard layout
- Onboarding completion rate up 15%
- Support tickets down significantly

Areas for improvement:
- Some users finding the navigation confusing
- Mobile experience needs work
- Performance on older devices

Let's discuss in our next sync.`,
    priority: "normal",
    tags: ["feedback", "product"],
  },
  {
    subject: "Contract renewal discussion",
    content: `Hi,

Our current agreement expires at the end of this month. I wanted to reach out early to discuss renewal terms.

We've been very happy with the partnership and would like to continue. However, given our growth, we'd like to explore:

1. Volume discounts for increased usage
2. Additional features in the enterprise tier
3. Extended support hours

Can we schedule a call to discuss?`,
    priority: "high",
    tags: ["contract", "sales"],
  },
  {
    subject: "Security audit report - Action required",
    content: `Hi,

Please find attached our quarterly security audit report.

Summary:
- 2 high-priority items requiring immediate attention
- 5 medium-priority recommendations
- 8 low-priority suggestions

The high-priority items relate to:
1. API authentication token expiry policy
2. Database encryption at rest

Please review and confirm remediation timelines by EOW.`,
    priority: "urgent",
    tags: ["security", "audit"],
  },
  {
    subject: "Team offsite planning",
    content: `Hi everyone,

It's time to start planning our Q2 team offsite!

Proposed dates: March 15-17
Location options:
- Option A: Mountain retreat (outdoor activities)
- Option B: City hotel (easy access, restaurants)
- Option C: Beach resort (relaxation focus)

Please vote in the poll and add any dietary restrictions or accessibility needs.

Looking forward to it!`,
    priority: "low",
    tags: ["team", "offsite"],
  },
  {
    subject: "Customer escalation - Enterprise account",
    content: `ESCALATION: Enterprise customer (Annual contract: $500K)

Issue: Customer experiencing data sync failures for 3 days

Impact:
- Their team cannot access updated reports
- They have a board meeting tomorrow
- Threatening to pause contract renewal

Previous attempts:
- Support ticket #45892 opened Monday
- Engineering investigated but couldn't reproduce
- Customer increasingly frustrated

Need executive attention on this.`,
    priority: "urgent",
    tags: ["escalation", "enterprise", "support"],
  },
];

// Slack message templates
const SLACK_TEMPLATES: Array<{
  subject: string;
  content: string;
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
}> = [
  {
    subject: "Deploy notification",
    content: `Deployed v2.4.1 to production

Changes:
- Fixed memory leak in worker process
- Added rate limiting to public API
- Updated dependencies

Rollback available if needed.`,
    priority: "normal",
    tags: ["deploy", "engineering"],
  },
  {
    subject: "Quick question about the API",
    content: `Hey! Do you have a minute? I'm trying to understand the auth flow for the new endpoint and the docs are a bit unclear.

Specifically - should we be using JWT or API keys for service-to-service calls?`,
    priority: "normal",
    tags: ["question", "api"],
  },
  {
    subject: "Build failing on main",
    content: `Heads up - main branch is red

Looks like a flaky test in the payments module. I'm looking into it now but might need help from someone familiar with that code.`,
    priority: "high",
    tags: ["ci", "build"],
  },
  {
    subject: "Great news from the customer call!",
    content: `Just got off a call with Acme Corp - they're upgrading to Enterprise!

This brings our Q1 number to 112% of target. Huge thanks to the product team for the features that closed this deal.`,
    priority: "normal",
    tags: ["sales", "win"],
  },
  {
    subject: "Standup reminder",
    content: `Daily standup in 5 minutes!

Zoom link: https://zoom.us/j/123456789

Agenda:
- Sprint progress
- Blockers
- Announcements`,
    priority: "low",
    tags: ["meeting", "standup"],
  },
  {
    subject: "PagerDuty Alert: High memory usage",
    content: `ALERT: Memory usage on prod-worker-03 exceeded 90%

Current: 93.2%
Threshold: 90%

Auto-scaling triggered. Investigating root cause.`,
    priority: "urgent",
    tags: ["alert", "monitoring"],
  },
];

// Linear issue templates
const LINEAR_TEMPLATES: Array<{
  subject: string;
  content: string;
  priority: "urgent" | "high" | "normal" | "low";
  tags: string[];
}> = [
  {
    subject: "[Bug] Users unable to export data in CSV format",
    content: `**Description:**
Users clicking the "Export CSV" button receive a 500 error.

**Steps to reproduce:**
1. Go to Reports dashboard
2. Select date range
3. Click "Export CSV"

**Expected:** CSV file downloads
**Actual:** Error toast appears

**Affected users:** ~50 reports in last hour`,
    priority: "high",
    tags: ["bug", "export"],
  },
  {
    subject: "[Feature] Add dark mode support",
    content: `**User story:**
As a user, I want to use dark mode so that I can reduce eye strain when working at night.

**Acceptance criteria:**
- [ ] Toggle in settings
- [ ] Persists across sessions
- [ ] Respects system preference by default
- [ ] All components properly themed`,
    priority: "normal",
    tags: ["feature", "ui"],
  },
  {
    subject: "[Task] Update API documentation",
    content: `The API docs are out of date after the v2.3 release.

Sections needing updates:
- Authentication (new OAuth flow)
- Rate limits (increased for Pro tier)
- New endpoints (webhooks, batch operations)

Deadline: Before the developer conference next month.`,
    priority: "normal",
    tags: ["docs", "api"],
  },
  {
    subject: "[Bug] Critical: Payment processing stuck",
    content: `**CRITICAL BUG**

Payments are not being processed. Stripe webhooks are failing silently.

Impact: $50K in pending transactions
Started: 2 hours ago

Currently investigating webhook endpoint logs.`,
    priority: "urgent",
    tags: ["bug", "payments", "critical"],
  },
  {
    subject: "[Improvement] Optimize database queries on dashboard",
    content: `Dashboard load time has increased to 3.2s (was 800ms).

Analysis shows N+1 queries in the activity feed component.

Proposed fix:
- Add eager loading for user associations
- Implement pagination
- Add Redis caching layer

Estimated effort: 2-3 days`,
    priority: "high",
    tags: ["performance", "database"],
  },
];

// Helper to generate a random date in the last 7 days
function randomRecentDate(): Date {
  const now = new Date();
  const daysAgo = Math.random() * 7;
  const hoursAgo = Math.random() * 24;
  return new Date(now.getTime() - (daysAgo * 24 + hoursAgo) * 60 * 60 * 1000);
}

// Helper to pick random item from array
function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Generate fake email items
export function generateFakeEmails(count: number = 10): NewInboxItem[] {
  const items: NewInboxItem[] = [];

  for (let i = 0; i < count; i++) {
    const person = randomPick(PEOPLE);
    const template = randomPick(EMAIL_TEMPLATES);

    items.push({
      connector: "gmail",
      externalId: `email-${Date.now()}-${i}`,
      sender: person.email,
      senderName: person.name,
      senderAvatar: person.avatar,
      subject: template.subject,
      content: `${template.content}\n\n${person.name}\n${person.company}`,
      preview: template.content.slice(0, 120) + "...",
      status: "new",
      priority: template.priority,
      tags: template.tags,
      receivedAt: randomRecentDate(),
      enrichment: {
        linkedEntities: [
          { id: crypto.randomUUID(), name: person.name, type: "person" },
          { id: crypto.randomUUID(), name: person.company, type: "company" },
        ],
      },
    });
  }

  return items;
}

// Generate fake Slack messages
export function generateFakeSlackMessages(count: number = 8): NewInboxItem[] {
  const items: NewInboxItem[] = [];

  for (let i = 0; i < count; i++) {
    const source = randomPick(SLACK_SOURCES);
    const template = randomPick(SLACK_TEMPLATES);

    items.push({
      connector: "slack",
      externalId: `slack-${Date.now()}-${i}`,
      sender: source.channel,
      senderName: source.user,
      senderAvatar: null,
      subject: template.subject,
      content: template.content,
      preview: template.content.slice(0, 100) + "...",
      status: "new",
      priority: template.priority,
      tags: [...template.tags, "slack"],
      receivedAt: randomRecentDate(),
      enrichment: {
        linkedEntities: [
          { id: crypto.randomUUID(), name: source.user, type: "person" },
        ],
      },
    });
  }

  return items;
}

// Generate fake Linear issues
export function generateFakeLinearIssues(count: number = 6): NewInboxItem[] {
  const items: NewInboxItem[] = [];

  for (let i = 0; i < count; i++) {
    const project = randomPick(LINEAR_PROJECTS);
    const template = randomPick(LINEAR_TEMPLATES);
    const assignee = randomPick(PEOPLE);

    items.push({
      connector: "linear",
      externalId: `linear-${Date.now()}-${i}`,
      sender: project,
      senderName: assignee.name,
      senderAvatar: assignee.avatar,
      subject: template.subject,
      content: template.content,
      preview: template.content.slice(0, 100) + "...",
      status: "new",
      priority: template.priority,
      tags: [...template.tags, "linear"],
      receivedAt: randomRecentDate(),
      enrichment: {
        linkedEntities: [
          { id: crypto.randomUUID(), name: assignee.name, type: "person" },
          { id: crypto.randomUUID(), name: project, type: "project" },
        ],
      },
    });
  }

  return items;
}

// Generate a mixed batch of fake inbox items with AI enrichment
export async function generateFakeInboxItems(): Promise<NewInboxItem[]> {
  const items = [
    ...generateFakeEmails(12),
    ...generateFakeSlackMessages(8),
    ...generateFakeLinearIssues(6),
  ];

  // Apply enrichment to all items
  const enrichedItems = await Promise.all(
    items.map(async (item) => ({
      ...item,
      enrichment: await enrichTriageItem(item),
    }))
  );

  // Sort by priority then date
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  return enrichedItems.sort((a, b) => {
    // First by priority from enrichment
    const priorityA = a.enrichment?.suggestedPriority || a.priority;
    const priorityB = b.enrichment?.suggestedPriority || b.priority;
    const priorityDiff =
      priorityOrder[priorityA as keyof typeof priorityOrder] -
      priorityOrder[priorityB as keyof typeof priorityOrder];
    if (priorityDiff !== 0) return priorityDiff;

    // Then by date (newest first)
    const dateA = a.receivedAt instanceof Date ? a.receivedAt : new Date(a.receivedAt!);
    const dateB = b.receivedAt instanceof Date ? b.receivedAt : new Date(b.receivedAt!);
    return dateB.getTime() - dateA.getTime();
  });
}

// Get a specific number of items sorted by priority and date
export function getTriageQueue(items: NewInboxItem[]): NewInboxItem[] {
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };

  return items
    .filter((item) => item.status === "new")
    .sort((a, b) => {
      // First by priority
      const priorityDiff =
        priorityOrder[a.priority as keyof typeof priorityOrder] -
        priorityOrder[b.priority as keyof typeof priorityOrder];
      if (priorityDiff !== 0) return priorityDiff;

      // Then by date (newest first)
      const dateA = a.receivedAt instanceof Date ? a.receivedAt : new Date(a.receivedAt!);
      const dateB = b.receivedAt instanceof Date ? b.receivedAt : new Date(b.receivedAt!);
      return dateB.getTime() - dateA.getTime();
    });
}
