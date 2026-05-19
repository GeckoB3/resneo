'use client';

import { useState } from 'react';
import { normalizeToE164 } from '@/lib/phone/e164';
import { defaultPhoneCountryForVenueCurrency } from '@/lib/phone/default-country';

interface AppointmentWaitlistJoinProps {
  venueId: string;
  serviceId: string;
  date: string;
  practitionerId?: string | null;
  currency?: string;
}

export function AppointmentWaitlistJoin({
  venueId,
  serviceId,
  date,
  practitionerId,
  currency,
}: AppointmentWaitlistJoinProps) {
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [desiredTime, setDesiredTime] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const phoneCountry = defaultPhoneCountryForVenueCurrency(currency);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const guestPhone = normalizeToE164(phone, phoneCountry);
    if (!firstName.trim() || !lastName.trim() || !guestPhone) return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/booking/appointment-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          service_id: serviceId,
          desired_date: date,
          desired_time: desiredTime || undefined,
          practitioner_id: practitionerId ?? undefined,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          guest_phone: guestPhone,
          guest_email: email || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus('success');
        setMessage(data.message ?? 'You have been added to the waitlist.');
      } else {
        setStatus('error');
        setMessage(data.error ?? 'Failed to join waitlist');
      }
    } catch {
      setStatus('error');
      setMessage('Something went wrong. Please try again.');
    }
  }

  if (status === 'success') {
    return (
      <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
        {message}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-medium text-brand-700 transition-colors hover:bg-brand-100"
      >
        Join waitlist
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 w-full space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
      <p className="text-xs font-medium text-slate-600">We will contact you if an appointment opens on this day.</p>
      {status === 'error' ? <p className="text-xs text-red-600">{message}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          required
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          placeholder="First name"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        <input
          required
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          placeholder="Last name"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
      </div>
      <input
        required
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Mobile number"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (optional)"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <input
        type="time"
        value={desiredTime}
        onChange={(e) => setDesiredTime(e.target.value)}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {status === 'submitting' ? 'Submitting…' : 'Join waitlist'}
      </button>
    </form>
  );
}
