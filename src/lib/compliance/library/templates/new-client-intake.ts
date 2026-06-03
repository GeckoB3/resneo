import { defineTemplate } from '@/lib/compliance/library/field-types';

export const newClientIntakeTemplate = defineTemplate({
  slug: 'lib-new-client-intake-v1',
  name: 'New Client Intake Form',
  category: 'intake',
  result_type: 'completed',
  validity_period_days: null,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Basic intake details captured once on a client’s first visit.',
  form_schema: {
    schema_version: '1.0',
    title: 'New Client Intake Form',
    description: 'Please tell us a little about you so we can look after you safely.',
    fields: [
      { id: 'f_full_name', type: 'text', label: 'Full name', required: true, max_length: 200 },
      { id: 'f_date_of_birth', type: 'date', label: 'Date of birth', required: false },
      {
        id: 'f_medical_conditions',
        type: 'textarea',
        label: 'Do you have any medical conditions we should be aware of?',
        required: false,
        max_length: 1000,
      },
      {
        id: 'f_medications',
        type: 'textarea',
        label: 'Are you currently taking any medications?',
        required: false,
        max_length: 1000,
      },
      {
        id: 'f_allergies',
        type: 'textarea',
        label: 'Do you have any allergies?',
        required: false,
        max_length: 1000,
      },
      {
        id: 'f_emergency_contact',
        type: 'text',
        label: 'Emergency contact (name and number)',
        required: false,
        max_length: 200,
      },
      {
        id: 'f_consent',
        type: 'select',
        label: 'I confirm the information above is accurate.',
        required: true,
        options: [{ value: 'agree', label: 'I agree' }],
      },
    ],
  },
});
