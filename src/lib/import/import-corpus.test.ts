/**
 * Eval corpus: pins the deterministic import pipeline against provider-faithful
 * fixtures. Every messy-input behaviour the tool claims (header junk, encodings,
 * delimiters, AM/PM, decimal commas, combined datetimes, date-order inference)
 * is asserted here so it can never silently regress.
 */

import { describe, expect, it } from 'vitest';
import { CORPUS } from '@/lib/import/__fixtures__/corpus';
import { ingestUploadedFile } from '@/lib/import/ingest-file';
import { inferDateFormatFromProfiles, profileColumns } from '@/lib/import/column-profile';
import { detectPlatform, PLATFORM_MAPPINGS, platformTemplateKey } from '@/lib/import/constants';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';
import {
  parseCurrencyPence,
  parseDateString,
  parseTimeString,
  mapImportBookingStatus,
} from '@/lib/import/normalize';

function fixture(name: string) {
  const f = CORPUS.find((c) => c.name === name);
  if (!f) throw new Error(`fixture not found: ${name}`);
  return f;
}

function mappingRowsFrom(expected: Record<string, string>): DbMappingRow[] {
  return Object.entries(expected).map(([source_column, target_field]) => ({
    id: source_column,
    source_column,
    target_field,
    action: 'map',
    custom_field_name: null,
    custom_field_type: null,
    split_config: null,
  }));
}

describe('import corpus — ingestion', () => {
  it('every fixture ingests with the expected headers', () => {
    for (const f of CORPUS) {
      const { datasets } = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8'));
      expect(datasets, f.name).toHaveLength(1);
      const headers = datasets[0]!.headers;
      for (const col of Object.keys(f.expectedMappings)) {
        expect(headers, `${f.name}: ${col}`).toContain(col);
      }
    }
  });

  it('drops title/metadata rows in the EU export and reads semicolons', () => {
    const f = fixture('EU semicolon CSV with decimal-comma prices and title rows');
    const { datasets } = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8'));
    const ds = datasets[0]!;
    expect(ds.headerRowIndex).toBe(2);
    expect(ds.headers).toEqual(['E-Mail', 'Datum', 'Uhrzeit', 'Behandlung', 'Mitarbeiter', 'Preis']);
    expect(ds.rows[0]!['Preis']).toBe('1.234,56');
    expect(parseCurrencyPence(ds.rows[0]!['Preis'])).toBe(123456);
  });
});

describe('import corpus — platform detection and templates', () => {
  it('detects known platforms from headers/filenames', () => {
    for (const f of CORPUS) {
      const { datasets } = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8'));
      const { platform } = detectPlatform(datasets[0]!.headers, f.filename);
      expect(platform, f.name).toBe(f.expectedPlatform ?? 'unknown');
    }
  });

  it('platform templates agree with the golden mappings where defined', () => {
    for (const f of CORPUS) {
      if (!f.expectedPlatform) continue;
      const key = platformTemplateKey(f.expectedPlatform as never, f.fileType);
      const template = key ? PLATFORM_MAPPINGS[key] : null;
      expect(template, f.name).toBeTruthy();
      for (const [col, field] of Object.entries(template!)) {
        if (f.expectedMappings[col]) {
          expect(f.expectedMappings[col], `${f.name}: ${col}`).toBe(field);
        }
      }
    }
  });
});

describe('import corpus — date-format inference', () => {
  it('infers day-first for UK/EU exports and month-first for US exports', () => {
    const uk = fixture('Phorest future appointments export');
    const ukDs = ingestUploadedFile(uk.filename, Buffer.from(uk.csv, 'utf-8')).datasets[0]!;
    expect(inferDateFormatFromProfiles(profileColumns(ukDs.headers, ukDs.rows))).toBe('dd/MM/yyyy');

    const us = fixture('US-format bookings with AM/PM times');
    const usDs = ingestUploadedFile(us.filename, Buffer.from(us.csv, 'utf-8')).datasets[0]!;
    expect(inferDateFormatFromProfiles(profileColumns(usDs.headers, usDs.rows))).toBe('MM/dd/yyyy');
  });
});

describe('import corpus — end-to-end row normalisation', () => {
  it('US AM/PM bookings normalise to ISO date + 24h time', () => {
    const f = fixture('US-format bookings with AM/PM times');
    const ds = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8')).datasets[0]!;
    const maps = mappingRowsFrom(f.expectedMappings);
    const { targets } = applyMappingsToDataRow(ds.rows[0]!, maps);
    expect(parseDateString(targets.booking_date!, 'MM/dd/yyyy').iso).toBe('2026-03-14');
    expect(parseTimeString(targets.booking_time!)).toBe('14:30:00');
    expect(parseCurrencyPence(targets.price!)).toBe(9500);
  });

  it('Timely combined datetime recovers booking_time automatically', () => {
    const f = fixture('Timely-style combined datetime');
    const ds = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8')).datasets[0]!;
    const maps = mappingRowsFrom(f.expectedMappings);

    const slash = applyMappingsToDataRow(ds.rows[0]!, maps).targets;
    expect(parseDateString(slash.booking_date!, 'dd/MM/yyyy').iso).toBe('2026-07-14');
    expect(parseTimeString(slash.booking_time!)).toBe('14:30:00');

    const iso = applyMappingsToDataRow(ds.rows[1]!, maps).targets;
    expect(parseDateString(iso.booking_date!).iso).toBe('2026-07-15');
    expect(parseTimeString(iso.booking_time!)).toBe('09:00:00');
  });

  it('Phorest statuses map onto ResNeo booking statuses', () => {
    expect(mapImportBookingStatus({ rawStatus: 'BOOKED' })).toBe('Booked');
    expect(mapImportBookingStatus({ rawStatus: 'PAID' })).toBe('Completed');
    expect(mapImportBookingStatus({ rawStatus: 'BOOKED', activationState: 'CANCELED' })).toBe('Cancelled');
  });

  it('Booksy comma-format names split into last/first correctly', () => {
    const f = fixture('Booksy clients with combined name');
    const ds = ingestUploadedFile(f.filename, Buffer.from(f.csv, 'utf-8')).datasets[0]!;
    const maps = mappingRowsFrom(f.expectedMappings);
    const second = applyMappingsToDataRow(ds.rows[1]!, maps).targets;
    expect(second.first_name).toBe('John');
    expect(second.last_name).toBe('Smith');
  });
});
