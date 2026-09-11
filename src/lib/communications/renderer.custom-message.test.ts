import { describe, expect, it } from 'vitest';
import { renderCommunicationEmail, renderCommunicationSms } from './renderer';
import type { BookingEmailData, VenueEmailData } from '@/lib/emails/types';

const booking: BookingEmailData = {
  id: 'b1',
  guest_name: 'Priya Patel',
  guest_email: 'priya@example.com',
  guest_phone: '07700900123',
  booking_date: '2026-09-18',
  booking_time: '14:30',
  party_size: 4,
  special_requests: 'Window seat',
  booking_model: 'unified_scheduling',
};

const venue: VenueEmailData = {
  name: 'Willow & Sage Studio',
  address: '12 Market Row, Bath BA1 5AA',
  phone: '01225 123456',
  website_url: 'https://willowandsage.co.uk',
  brand_colour: '#7C3AED',
};

describe('custom_message rendering', () => {
  it('email never carries booking details, whichever surface started it', () => {
    const out = renderCommunicationEmail({
      lane: 'appointments_other',
      messageKey: 'custom_message',
      booking,
      venue,
      message: 'Hello from us.',
    });
    expect(out).not.toBeNull();
    expect(out!.subject).toBe('A message from Willow & Sage Studio');
    expect(out!.html).toContain('Hi Priya,');
    expect(out!.html).toContain('Hello from us.');
    expect(out!.html).not.toContain('14:30');
    expect(out!.html).not.toContain('18 September');
    expect(out!.html).not.toContain('Window seat');
    expect(out!.text).not.toContain('14:30');
    expect(out!.text).toContain('12 Market Row');
  });

  it('sms keeps paragraphs and allows more than one segment', () => {
    const long = `${'Thursday late opening until 9pm. '.repeat(6)}\n\nBook online.`;
    const out = renderCommunicationSms({
      lane: 'appointments_other',
      messageKey: 'custom_message',
      booking,
      venue,
      message: long,
    });
    expect(out!.body.startsWith('Willow & Sage Studio: Thursday')).toBe(true);
    expect(out!.body).toContain('\n\nBook online.');
    expect(out!.body.length).toBeGreaterThan(160);
    expect(out!.body.length).toBeLessThanOrEqual(459);
  });
});
