'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';

export interface CreatedContactSummary {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CreateContactModalProps {
  onClose: () => void;
  /** Called after a successful save. `created` is false when an existing contact matched by email/phone. */
  onCreated: (guest: CreatedContactSummary, created: boolean) => void;
  /** Singular noun from venue terminology, e.g. "guest" or "client". */
  clientNoun: string;
}

const CREATE_CONTACT_INPUT_CLASS =
  'mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-50';

/**
 * Modal for adding a contact directly from the directory (no booking required).
 * The server dedupes by email then phone, so saving someone who already exists
 * opens their record instead of creating a duplicate. Mount only when shown so
 * field state resets without effects.
 */
export function CreateContactModal({ onClose, onCreated, clientNoun }: CreateContactModalProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasIdentity =
    firstName.trim() !== '' || lastName.trim() !== '' || email.trim() !== '' || phone.trim() !== '';
  const hasReachableDetail = email.trim() !== '' || phone.trim() !== '';

  const submit = async () => {
    if (!hasIdentity || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/venue/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        guest?: CreatedContactSummary;
        created?: boolean;
        error?: string;
      };
      if (!res.ok || !data.guest) {
        throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save contact');
      }
      onCreated(data.guest, data.created === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save contact');
      setSaving(false);
    }
  };

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !saving) onClose();
      }}
      size="md"
      title={`New ${clientNoun}`}
      description={`Add a ${clientNoun} to your contacts without creating a booking. If the email or phone already exists, their existing record opens instead.`}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="min-h-[44px] rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !hasIdentity}
            onClick={() => void submit()}
            className="min-h-[44px] rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : `Add ${clientNoun}`}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="create-contact-first-name" className="block text-xs font-medium text-slate-600">
              First name
            </label>
            <input
              id="create-contact-first-name"
              type="text"
              value={firstName}
              maxLength={100}
              onChange={(e) => setFirstName(e.target.value)}
              onKeyDown={onFieldKeyDown}
              disabled={saving}
              autoComplete="off"
              className={CREATE_CONTACT_INPUT_CLASS}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="create-contact-last-name" className="block text-xs font-medium text-slate-600">
              Last name
            </label>
            <input
              id="create-contact-last-name"
              type="text"
              value={lastName}
              maxLength={100}
              onChange={(e) => setLastName(e.target.value)}
              onKeyDown={onFieldKeyDown}
              disabled={saving}
              autoComplete="off"
              className={CREATE_CONTACT_INPUT_CLASS}
            />
          </div>
        </div>
        <div>
          <label htmlFor="create-contact-email" className="block text-xs font-medium text-slate-600">
            Email
          </label>
          <input
            id="create-contact-email"
            type="email"
            value={email}
            maxLength={255}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onFieldKeyDown}
            disabled={saving}
            autoComplete="off"
            placeholder="name@example.com"
            className={CREATE_CONTACT_INPUT_CLASS}
          />
        </div>
        <div>
          <label htmlFor="create-contact-phone" className="block text-xs font-medium text-slate-600">
            Phone
          </label>
          <input
            id="create-contact-phone"
            type="tel"
            value={phone}
            maxLength={24}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={onFieldKeyDown}
            disabled={saving}
            autoComplete="off"
            placeholder="07911 123456"
            className={CREATE_CONTACT_INPUT_CLASS}
          />
        </div>
        {hasIdentity && !hasReachableDetail ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Without an email or phone number this {clientNoun} is listed under “All identified guests”
            rather than the default “Saved contact details” view.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
