import { defineTemplate } from '@/lib/compliance/library/field-types';

export const massageIntakeTemplate = defineTemplate({
  slug: 'lib-massage-intake-v1',
  name: 'Massage Therapy Intake',
  category: 'intake',
  result_type: 'completed',
  validity_period_days: 365,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Health and preference questionnaire for massage treatments.',
  form_schema: {
    schema_version: '1.0',
    title: 'Massage Therapy Intake',
    description: 'Help your therapist tailor your treatment and keep you safe.',
    fields: [
      {
        id: 'f_areas_of_concern',
        type: 'textarea',
        label: 'Areas of concern or pain',
        required: false,
        max_length: 1000,
      },
      {
        id: 'f_medical_history',
        type: 'textarea',
        label: 'Relevant medical history (injuries, surgeries, conditions)',
        required: false,
        max_length: 2000,
      },
      {
        id: 'f_pregnant',
        type: 'select',
        label: 'Are you pregnant?',
        required: true,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'not_applicable', label: 'Not applicable' },
        ],
      },
      {
        id: 'f_pressure_pref',
        type: 'select',
        label: 'Preferred pressure',
        required: false,
        options: [
          { value: 'light', label: 'Light' },
          { value: 'medium', label: 'Medium' },
          { value: 'firm', label: 'Firm' },
        ],
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
