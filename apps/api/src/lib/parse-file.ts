import { parse as parseCsv } from 'csv-parse/sync';

export interface ParsedAddressRow {
  externalId?: string;
  originalText: string;
}

const ACCENT_MAP: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n' };

/**
 * Real-world exports rarely match a header exactly ("Direccion 1" from an
 * Excel column titled just once, "DIRECCION", trailing whitespace, etc.), so
 * this normalizes before comparing: lowercase, strip accents, strip a
 * trailing " <number>" some exports append, trim.
 */
function normalizeHeader(key: string): string {
  return key
    .toLowerCase()
    .replace(/[áéíóúñ]/g, (ch) => ACCENT_MAP[ch] ?? ch)
    .replace(/\s+\d+$/, '')
    .trim();
}

const ADDRESS_KEYS = ['direccion', 'address', 'addr'];
const ID_KEYS = ['id', 'external_id', 'externalid'];

function pickField(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of Object.keys(row)) {
    const normalized = normalizeHeader(key);
    if (keys.some((k) => normalized === k || normalized.startsWith(k))) {
      const value = row[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        return String(value).trim();
      }
    }
  }
  return undefined;
}

export class FileParseError extends Error {}

export function parseAddressFile(filename: string, content: Buffer): ParsedAddressRow[] {
  const isJson = filename.toLowerCase().endsWith('.json');
  const rawRows: Record<string, unknown>[] = isJson
    ? parseJson(content)
    : parseCsv(content, { columns: true, skip_empty_lines: true, trim: true });

  const rows: ParsedAddressRow[] = [];
  for (const [index, row] of rawRows.entries()) {
    const originalText = pickField(row, ADDRESS_KEYS);
    if (!originalText) {
      throw new FileParseError(
        `Fila ${index + 1}: falta la columna "direccion" (o "address"). Columnas encontradas: ${Object.keys(row).join(', ')}`
      );
    }
    rows.push({ originalText, externalId: pickField(row, ID_KEYS) });
  }

  if (rows.length === 0) {
    throw new FileParseError('El archivo no contiene filas de datos.');
  }

  return rows;
}

function parseJson(content: Buffer): Record<string, unknown>[] {
  let data: unknown;
  try {
    data = JSON.parse(content.toString('utf-8'));
  } catch {
    throw new FileParseError('El archivo JSON no es válido.');
  }
  if (!Array.isArray(data)) {
    throw new FileParseError('El JSON debe ser un arreglo de objetos, ej: [{"direccion": "..."}].');
  }
  return data as Record<string, unknown>[];
}
