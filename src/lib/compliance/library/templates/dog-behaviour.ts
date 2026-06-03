import { defineTemplate } from '@/lib/compliance/library/field-types';

export const dogBehaviourTemplate = defineTemplate({
  slug: 'lib-dog-behaviour-v1',
  name: 'Dog Behaviour Assessment',
  category: 'intake',
  result_type: 'completed',
  validity_period_days: null,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Temperament and handling notes captured once for a dog.',
  form_schema: {
    schema_version: '1.0',
    title: 'Dog Behaviour Assessment',
    description: 'Help us groom your dog safely and calmly.',
    fields: [
      { id: 'f_dog_name', type: 'text', label: 'Dog’s name', required: true, max_length: 100 },
      {
        id: 'f_temperament',
        type: 'select',
        label: 'General temperament',
        required: true,
        options: [
          { value: 'calm', label: 'Calm' },
          { value: 'anxious', label: 'Anxious' },
          { value: 'reactive', label: 'Reactive' },
          { value: 'unknown', label: 'Unknown' },
        ],
      },
      {
        id: 'f_bite_history',
        type: 'select',
        label: 'Has your dog ever bitten or attempted to bite?',
        required: true,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
      {
        id: 'f_handling_notes',
        type: 'textarea',
        label: 'Any handling notes or triggers we should know about?',
        required: false,
        max_length: 1000,
      },
    ],
  },
});
