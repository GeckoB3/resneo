import { defineTemplate } from '@/lib/compliance/library/field-types';

export const eyebrowPatchTestTemplate = defineTemplate({
  slug: 'lib-eyebrow-patch-test-v1',
  name: 'Eyebrow Tint Patch Test',
  category: 'test',
  result_type: 'pass_fail',
  validity_period_days: 90,
  capture_methods: ['staff_in_venue'],
  description: 'Patch test for sensitivity to eyebrow tint products.',
  form_schema: {
    schema_version: '1.0',
    title: 'Eyebrow Tint Patch Test',
    description: 'Patch test for sensitivity to eyebrow tint products.',
    fields: [
      {
        id: 'f_known_allergies',
        type: 'textarea',
        label: 'Do you have any known allergies or skin sensitivities?',
        required: true,
        max_length: 1000,
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
