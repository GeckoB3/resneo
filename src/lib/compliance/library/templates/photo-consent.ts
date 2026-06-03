import { defineTemplate } from '@/lib/compliance/library/field-types';

export const photoConsentTemplate = defineTemplate({
  slug: 'lib-photo-consent-v1',
  name: 'Photo/Social Media Consent',
  category: 'consent',
  result_type: 'signed',
  validity_period_days: null,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Consent to use photos of work on social media and marketing.',
  form_schema: {
    schema_version: '1.0',
    title: 'Photo/Social Media Consent',
    description: 'We’d love to share our work. Please let us know your preference.',
    fields: [
      {
        id: 'f_consent_choice',
        type: 'select',
        label: 'May we use photos of your treatment on social media and marketing?',
        required: true,
        options: [
          { value: 'i_consent', label: 'Yes, I consent' },
          { value: 'i_do_not_consent', label: 'No, I do not consent' },
        ],
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
