import { describe, expect, it } from 'vitest';
import { buildSampleCsv } from './sample';
import { parseCsv } from '@datadesk/shared/upload';
import { detectType, fromText, validateCell } from '@datadesk/shared/columnTypes';

/**
 * The sample file is the reference for later milestones: the worker (M4) must find exactly these
 * 4 planted mistakes. If this test changes, the M4 acceptance test must change with it.
 */
describe('sample ML review dataset', () => {
  const parsed = parseCsv(buildSampleCsv());
  const [header, ...rows] = parsed.rows;

  it('has 8 columns and 40 data rows', () => {
    expect(header).toEqual(['ticket_id', 'text', 'label', 'tags', 'confidence', 'needs_review', 'created_at', 'source_url']);
    expect(rows).toHaveLength(40);
    expect(parsed.parseErrors).toEqual([]);
  });

  it('auto-detects the expected column types', () => {
    const types = header.map((_, i) => detectType(rows.map((r) => r[i])).type);
    expect(types).toEqual(['integer', 'text', 'select', 'multiselect', 'number', 'boolean', 'date', 'url']);
  });

  it('contains exactly the 4 planted invalid cells', () => {
    const problems: string[] = [];
    header.forEach((name, i) => {
      const det = detectType(rows.map((r) => r[i]));
      const spec = { type: det.type, delimiter: det.delimiter, required: false };
      rows.forEach((r, ri) => {
        const err = validateCell(fromText(r[i], spec), spec);
        if (err) problems.push(`row ${ri + 1} ${name}: ${err}`);
      });
    });
    expect(problems.sort()).toEqual([
      'row 12 source_url: "not-a-link" is not a valid URL',
      'row 18 created_at: "2026-13-45" is not a valid date (use YYYY-MM-DD)',
      'row 26 needs_review: "maybe" is not true/false',
      'row 4 confidence: "n/a" is not a number',
    ]);
  });
});
