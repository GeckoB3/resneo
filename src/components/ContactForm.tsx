'use client';

import { useState } from 'react';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const initialFormData = {
  name: '',
  email: '',
  phone: '',
  restaurantName: '',
  message: '',
  company_website: '',
};

interface ContactFormProps {
  /** Override layout (default: centred, max-width for standalone sections). */
  className?: string;
}

export default function ContactForm({ className }: ContactFormProps) {
  const [formData, setFormData] = useState(initialFormData);
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMessage('');

    try {
      const phoneTrim = formData.phone.trim();
      const phoneE164 = phoneTrim ? normalizeToE164(formData.phone, 'GB') : null;
      if (phoneTrim && !phoneE164) {
        setStatus('error');
        setErrorMessage('Please enter a valid phone number.');
        return;
      }

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name.trim(),
          email: formData.email.trim(),
          phone: phoneE164 ?? undefined,
          restaurantName: formData.restaurantName.trim() || undefined,
          message: formData.message.trim() || undefined,
          company_website: formData.company_website,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        setStatus('error');
        setErrorMessage(json?.error ?? 'Something went wrong. Please try again.');
        return;
      }
      if (!json.success) {
        setStatus('error');
        setErrorMessage(json?.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setStatus('success');
      setFormData(initialFormData);
    } catch {
      setStatus('error');
      setErrorMessage('Something went wrong. Please try again.');
    }
  };

  if (status === 'success') {
    return (
      <p className="rounded-xl border border-brand-100 bg-brand-50/50 p-6 text-center text-slate-700">
        Thanks for getting in touch! We&apos;ll be in contact shortly.
      </p>
    );
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm placeholder:text-slate-300 focus:border-brand-500 focus:ring-1 focus:ring-brand-500';
  const labelClass = 'mb-1.5 block text-sm font-medium text-slate-700';

  const formClassName = ['space-y-4', className ?? 'mx-auto max-w-lg'].join(' ');

  return (
    <form onSubmit={handleSubmit} className={formClassName}>
      <input
        type="text"
        name="company_website"
        value={formData.company_website}
        onChange={handleChange}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <div>
        <label htmlFor="contact-name" className={labelClass}>
          Name <span className="text-red-500">*</span>
        </label>
        <input
          id="contact-name"
          type="text"
          name="name"
          value={formData.name}
          onChange={handleChange}
          placeholder="Your name"
          required
          className={inputClass}
          disabled={status === 'submitting'}
        />
      </div>

      <div>
        <label htmlFor="contact-email" className={labelClass}>
          Email <span className="text-red-500">*</span>
        </label>
        <input
          id="contact-email"
          type="email"
          name="email"
          value={formData.email}
          onChange={handleChange}
          placeholder="you@yourbusiness.com"
          required
          className={inputClass}
          disabled={status === 'submitting'}
        />
      </div>

      <div>
        <label htmlFor="contact-phone" className={labelClass}>
          Phone
        </label>
        <PhoneWithCountryField
          id="contact-phone"
          className="w-full min-w-0"
          value={formData.phone}
          onChange={(e164) => setFormData((prev) => ({ ...prev, phone: e164 }))}
          disabled={status === 'submitting'}
          inputClassName={inputClass}
        />
      </div>

      <div>
        <label htmlFor="contact-restaurant" className={labelClass}>
          Business Name
        </label>
        <input
          id="contact-restaurant"
          type="text"
          name="restaurantName"
          value={formData.restaurantName}
          onChange={handleChange}
          placeholder="Your business name"
          className={inputClass}
          disabled={status === 'submitting'}
        />
      </div>

      <div>
        <label htmlFor="contact-message" className={labelClass}>
          Message
        </label>
        <textarea
          id="contact-message"
          name="message"
          value={formData.message}
          onChange={handleChange}
          placeholder="Tell us about your business, or ask us anything..."
          rows={4}
          maxLength={2000}
          className={`${inputClass} resize-y`}
          disabled={status === 'submitting'}
        />
      </div>

      {status === 'error' && (
        <p className="text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-70"
      >
        {status === 'submitting' ? 'Sending...' : 'Get in Touch'}
      </button>
    </form>
  );
}
