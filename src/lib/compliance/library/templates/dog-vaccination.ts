import { defineTemplate } from '@/lib/compliance/library/field-types';

export const dogVaccinationTemplate = defineTemplate({
  slug: 'lib-dog-vaccination-v1',
  name: 'Dog Vaccination Record',
  category: 'certificate',
  result_type: 'file_uploaded',
  validity_period_days: null,
  capture_methods: ['client_online', 'staff_in_venue'],
  description: 'Upload of a current vaccination certificate for dog grooming.',
  form_schema: {
    schema_version: '1.0',
    title: 'Dog Vaccination Record',
    description: 'Please upload a copy of your dog’s up-to-date vaccination certificate.',
    fields: [
      { id: 'f_dog_name', type: 'text', label: 'Dog’s name', required: true, max_length: 100 },
      {
        id: 'f_vaccine_date',
        type: 'date',
        label: 'Date of last vaccination',
        required: false,
      },
      {
        id: 'f_certificate',
        type: 'file',
        label: 'Vaccination certificate',
        required: true,
        help_text: 'PDF or image, up to 10 MB.',
      },
    ],
  },
});
