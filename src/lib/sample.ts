import Papa from 'papaparse';

/** A small ML-review style dataset (with a few deliberately bad values) for trying the app. */
export function buildSampleCsv(): string {
  const texts = [
    'The checkout page keeps timing out on mobile',
    'Love the new dark mode, great work!',
    'Refund still not processed after 2 weeks',
    'How do I export my invoices?',
    'App crashes when uploading large photos',
    'Customer support was quick and helpful',
    'Pricing page is confusing, which plan has SSO?',
    'Search results are irrelevant for exact SKUs',
    'Please add a CSV import for contacts',
    'Notifications arrive hours late',
  ];
  const labels = ['bug', 'praise', 'billing', 'question', 'feature_request'];
  const labelFor = [0, 1, 2, 3, 0, 1, 3, 0, 4, 0];
  const tagPool = ['mobile', 'web', 'payments', 'ux', 'performance', 'support', 'export', 'search', 'onboarding'];

  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  const rows: string[][] = [];
  for (let i = 0; i < 40; i++) {
    const t = i % texts.length;
    const tags = Array.from(new Set([pick(tagPool), pick(tagPool), ...(rand() > 0.5 ? [pick(tagPool)] : [])]));
    const day = String(1 + (i % 28)).padStart(2, '0');
    rows.push([
      String(1000 + i),
      texts[t],
      labels[labelFor[t]],
      tags.join(', '),
      (0.5 + rand() * 0.5).toFixed(2),
      rand() > 0.6 ? 'yes' : 'no',
      `2026-10-${day}`,
      `https://support.example.com/tickets/${1000 + i}`,
    ]);
  }
  // A few problems for the reviewer to find
  rows[3][4] = 'n/a';
  rows[11][7] = 'not-a-link';
  rows[17][6] = '2026-13-45';
  rows[25][5] = 'maybe';

  return Papa.unparse({
    fields: ['ticket_id', 'text', 'label', 'tags', 'confidence', 'needs_review', 'created_at', 'source_url'],
    data: rows,
  });
}
