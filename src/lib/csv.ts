import Papa from 'papaparse';
import type { Column, Row } from '../types';
import { toText } from './columnTypes';

export interface ParsedCsv {
  data: string[][];
  delimiter: string;
  errors: string[];
}

function finish(res: Papa.ParseResult<string[]>): ParsedCsv {
  return {
    data: res.data,
    delimiter: res.meta.delimiter,
    errors: res.errors.slice(0, 5).map((e) => (e.row !== undefined ? `Row ${e.row + 1}: ${e.message}` : e.message)),
  };
}

export function parseCsvFile(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: 'greedy',
      complete: (res) => resolve(finish(res)),
      error: (err) => reject(err),
    });
  });
}

export function parseCsvText(text: string): ParsedCsv {
  return finish(Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' }));
}

/** Multi-value cells are joined with their delimiter; Papa quotes any cell containing commas. */
export function toCsv(columns: Column[], rows: Row[]): string {
  return Papa.unparse({
    fields: columns.map((c) => c.name),
    data: rows.map((r) => columns.map((c) => toText(r.values[c.id], c))),
  });
}

export function downloadText(fileName: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
