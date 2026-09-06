import { z } from 'zod';

const MONTHS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
] as const;

const monthEnum = z.enum(MONTHS);
const yearEnum = z.string().regex(/^\d{4}$/, 'Ano inválido');

const numberField = z.preprocess(
  (value) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return 0;
      return Number(trimmed);
    }
    return value;
  },
  z
    .number()
    .int('Use apenas números inteiros.')
    .min(0, 'Informe um valor maior ou igual a zero.'),
);

export const registerSchema = z.object({
  month: monthEnum,
  year: yearEnum,
  entries: numberField,
  entriesCats: numberField,
  adoptions: numberField,
  adoptionsCats: numberField,
  returns: numberField,
  returnsCats: numberField,
  euthanasias: numberField,
  euthanasiasCats: numberField,
  naturalDeaths: numberField,
  naturalDeathsCats: numberField,
  diseases: numberField,
  diseasesCats: numberField,
  tutorReturn: numberField,
  tutorReturnCats: numberField,
  originReturn: numberField,
  originReturnCats: numberField,
});

export const submitSchema = registerSchema.extend({
  dynamicType: z.enum(['dinamica', 'dinamica_lar']),
});

export const deleteSchema = z.object({
  id: z.string().min(1),
});

export type DynamicsSubmit = z.infer<typeof submitSchema>;
