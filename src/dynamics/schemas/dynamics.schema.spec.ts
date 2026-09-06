import { submitSchema } from './dynamics.schema';

const validPayload = {
  month: '03',
  year: '2026',
  dynamicType: 'dinamica',
  entries: 1,
  entriesCats: 2,
  adoptions: 3,
  adoptionsCats: 4,
  returns: 5,
  returnsCats: 6,
  euthanasias: 7,
  euthanasiasCats: 8,
  naturalDeaths: 9,
  naturalDeathsCats: 10,
  diseases: 11,
  diseasesCats: 12,
  tutorReturn: 13,
  tutorReturnCats: 14,
  originReturn: 15,
  originReturnCats: 16,
};

describe('dynamics schemas', () => {
  it('preprocesses numeric strings and empty strings exactly like the frontend', () => {
    const result = submitSchema.parse({
      ...validPayload,
      entries: ' 42 ',
      entriesCats: '  ',
    });

    expect(result.entries).toBe(42);
    expect(result.entriesCats).toBe(0);
  });

  it('rejects invalid month, year, dynamic type, negative and decimal metrics', () => {
    const result = submitSchema.safeParse({
      ...validPayload,
      month: '13',
      year: '26',
      dynamicType: 'other',
      entries: -1,
      entriesCats: 1.5,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const details = result.error.flatten((issue) => issue.message);
    expect(details.fieldErrors.year).toContain('Ano inválido');
    expect(details.fieldErrors.entries).toContain(
      'Informe um valor maior ou igual a zero.',
    );
    expect(details.fieldErrors.entriesCats).toContain(
      'Use apenas números inteiros.',
    );
    expect(details.fieldErrors.month).toBeDefined();
    expect(details.fieldErrors.dynamicType).toBeDefined();
  });
});
