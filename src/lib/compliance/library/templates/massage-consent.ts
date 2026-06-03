import { defineTemplate } from '@/lib/compliance/library/field-types';

export const massageConsentTemplate = defineTemplate({
  slug: 'lib-massage-consent-v1',
  name: 'Massage Treatment Consent',
  category: 'consent',
  result_type: 'signed',
  validity_period_days: 0,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Per-visit consent to massage treatment.',
  form_schema: {
    schema_version: '1.0',
    title: 'Massage Treatment Consent',
    description: 'Please read and sign before your treatment.',
    intro_markdown:
      'Massage therapy is provided for relaxation and wellbeing. It is not a substitute for medical care.',
    fields: [
      {
        id: 'f_understand',
        type: 'select',
        label: 'I understand the nature of the treatment and consent to it.',
        required: true,
        options: [{ value: 'agree', label: 'I agree' }],
      },
      {
        id: 'f_date',
        type: 'date',
        label: 'Date',
        required: true,
        default_value: 'today',
      },
      {
        id: 'f_signature',
        type: 'signature',
        label: 'Client signature',
        required: true,
      },
    ],
  },
});
