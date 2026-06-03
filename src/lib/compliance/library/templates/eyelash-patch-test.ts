import { defineTemplate } from '@/lib/compliance/library/field-types';

export const eyelashPatchTestTemplate = defineTemplate({
  slug: 'lib-eyelash-patch-test-v1',
  name: 'Eyelash Tint/Extension Patch Test',
  category: 'test',
  result_type: 'pass_fail',
  validity_period_days: 90,
  capture_methods: ['staff_in_venue'],
  description: 'Patch test for sensitivity to lash tint and adhesive products.',
  form_schema: {
    schema_version: '1.0',
    title: 'Eyelash Tint/Extension Patch Test',
    description: 'Patch test for sensitivity to lash tint and adhesive products.',
    fields: [
      {
        id: 'f_known_allergies',
        type: 'textarea',
        label: 'Do you have any known allergies or eye sensitivities?',
        required: true,
        max_length: 1000,
      },
      {
        id: 'f_products',
        type: 'text',
        label: 'Products tested',
        required: false,
        max_length: 200,
      },
      {
        id: 'f_test_date',
        type: 'date',
        label: 'Date of patch test',
        required: true,
        default_value: 'today',
      },
      {
        id: 'f_result',
        type: 'select',
        label: 'Result',
        required: true,
        staff_only: true,
        options: [
          { value: 'pass', label: 'Pass' },
          { value: 'fail', label: 'Fail' },
          { value: 'inconclusive', label: 'Inconclusive' },
        ],
      },
      {
        id: 'f_signature',
        type: 'signature',
        label: 'Client signature',
        required: true,
      },
    ],
    result_mapping: {
      field: 'f_result',
      pass_values: ['pass'],
      fail_values: ['fail', 'inconclusive'],
    },
  },
});
