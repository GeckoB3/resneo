import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail, renderCommunicationSms } from '@/lib/communications/renderer';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const venue: VenueEmailData = { name: 'Glow Studio', address: '1 High St' };
const booking: BookingEmailData = {
  id: 'guest-1',
  guest_name: 'Jane Doe',
  guest_email: 'jane@example.com',
  guest_phone: '+447700900000',
  booking_date: '2026-07-10',
  booking_time: '14:00:00',
  party_size: 1,
  booking_model: 'unified_scheduling',
};

const complianceOpts = {
  lane: 'appointments_other' as const,
  booking,
  venue,
  complianceFormLink: 'https://reserveni.com/p/forms/abcdefghij',
  complianceFormName: 'PPD Patch Test',
  complianceExpiryDays: 14,
};

describe('compliance email rendering', () => {
  it('renders the form request email with name, link and expiry', () => {
    const out = renderCommunicationEmail({ ...complianceOpts, messageKey: 'compliance_form_request' });
    expect(out).not.toBeNull();
    expect(out!.subject).toContain('PPD Patch Test');
    expect(out!.html).toContain('PPD Patch Test');
    expect(out!.html).toContain('https://reserveni.com/p/forms/abcdefghij');
    expect(out!.html).toContain('14 days');
    expect(out!.text).toContain('expire in 14 days');
  });

  it('renders the reminder email', () => {
    const out = renderCommunicationEmail({ ...complianceOpts, messageKey: 'compliance_form_reminder' });
    expect(out!.subject).toContain('PPD Patch Test');
    expect(out!.html).toContain('reminder');
  });

  it('renders the record-expiring email', () => {
    const out = renderCommunicationEmail({ ...complianceOpts, messageKey: 'compliance_record_expiring' });
    expect(out!.subject.toLowerCase()).toContain('expiring');
    expect(out!.html).toContain('PPD Patch Test');
  });
});

describe('booking confirmation "Forms to complete" block', () => {
  it('lists outstanding compliance forms with links in the confirmation email', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking: {
        ...booking,
        compliance_forms: [{ name: 'PPD Patch Test', url: 'https://reserveni.com/p/forms/abcdefghij' }],
      },
      venue,
    });
    expect(out).not.toBeNull();
    expect(out!.html).toContain('Forms to complete before your visit');
    expect(out!.html).toContain('PPD Patch Test');
    expect(out!.html).toContain('https://reserveni.com/p/forms/abcdefghij');
    expect(out!.text).toContain('PPD Patch Test: https://reserveni.com/p/forms/abcdefghij');
  });

  it('omits the block when there are no forms', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'booking_confirmation',
      booking,
      venue,
    });
    expect(out!.html).not.toContain('Forms to complete before your visit');
  });
});

describe('compliance SMS rendering', () => {
  it('renders a single-segment form request SMS with the link', () => {
    const out = renderCommunicationSms({ ...complianceOpts, messageKey: 'compliance_form_request' });
    expect(out).not.toBeNull();
    expect(out!.body).toContain('Glow Studio');
    expect(out!.body).toContain('PPD Patch Test');
    expect(out!.body).toContain('https://reserveni.com/p/forms/abcdefghij');
  });

  it('renders the expiring-record SMS', () => {
    const out = renderCommunicationSms({ ...complianceOpts, messageKey: 'compliance_record_expiring' });
    expect(out!.body.toLowerCase()).toContain('expiring');
  });
});
