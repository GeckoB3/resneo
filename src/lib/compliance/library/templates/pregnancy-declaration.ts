import { defineTemplate } from '@/lib/compliance/library/field-types';

export const pregnancyDeclarationTemplate = defineTemplate({
  slug: 'lib-pregnancy-declaration-v1',
  name: 'Pregnancy Declaration',
  category: 'declaration',
  result_type: 'signed',
  validity_period_days: 0,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Per-visit declaration of pregnancy status for treatments with contraindications.',
  form_schema: {
    schema_version: '1.0',
    title: 'Pregnancy Declaration',
    description: 'Some treatments are not suitable during pregnancy. Please declare your status.',
    fields: [
      {
        id: 'f_is_pregnant',
        type: 'select',
        label: 'Are you currently pregnant?',
        required: true,
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
      {
        id: 'f_weeks',
        type: 'text',
        label: 'If yes, how many weeks?',
        required: false,
        max_length: 20,
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
