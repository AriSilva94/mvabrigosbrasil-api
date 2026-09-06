import { z } from 'zod';

export function unformatDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function parseTemporaryAgreementValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'true' || normalizedValue === 'sim') {
    return true;
  }

  if (normalizedValue === 'false' || normalizedValue === 'nao') {
    return false;
  }

  return null;
}

const temporaryAgreementSchema = z
  .union([z.boolean(), z.enum(['true', 'false', 'sim', 'nao'])])
  .optional()
  .transform((value) => parseTemporaryAgreementValue(value) ?? false);

export const shelterProfileSchema = z
  .object({
    shelterType: z.string().min(1, 'Selecione o tipo de abrigo.'),
    cnpj: z.string().min(1, 'Informe o documento.'),
    shelterName: z.string().min(1, 'Informe o nome do abrigo.'),
    cep: z.string().min(1, 'Informe o CEP.'),
    street: z.string().min(1, 'Informe a rua.'),
    number: z.coerce.number().min(0, 'Informe o número.'),
    district: z.string().min(1, 'Informe o bairro.'),
    state: z.string().min(1, 'Selecione o estado.'),
    city: z.string().min(1, 'Informe a cidade.'),
    website: z.string().optional(),
    foundationDate: z.string().min(1, 'Informe a fundação do abrigo.'),
    species: z.string().min(1, 'Informe a espécie principal.'),
    additionalSpecies: z.array(z.string()).optional(),
    temporaryAgreement: temporaryAgreementSchema,
    referralSource: z.string().min(1, 'Selecione como conheceu o projeto.'),
    initialDogs: z.coerce
      .number()
      .min(0, 'Informe a população inicial de cães.'),
    initialCats: z.coerce
      .number()
      .min(0, 'Informe a população inicial de gatos.'),
    initialDogsLt: z.coerce
      .number()
      .min(0, 'Informe a população inicial de cães L.T.')
      .optional(),
    initialCatsLt: z.coerce
      .number()
      .min(0, 'Informe a população inicial de gatos L.T.')
      .optional(),
    authorizedName: z.string().min(1, 'Informe o nome do responsável.'),
    authorizedRole: z.string().min(1, 'Selecione o cargo.'),
    authorizedEmail: z.string().email('Informe um e-mail válido.'),
    authorizedPhone: z.string().min(1, 'Informe o telefone.'),
    acceptTerms: z.boolean().refine((value) => value === true, {
      message: 'Você deve aceitar os termos.',
    }),
  })
  .superRefine((data, ctx) => {
    const cnpjDigits = unformatDigits(data.cnpj);
    const isTemporary = data.shelterType === 'temporary';

    if (isTemporary) {
      if (cnpjDigits.length !== 11) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe um CPF válido (11 dígitos).',
          path: ['cnpj'],
        });
      }
    } else {
      if (cnpjDigits.length !== 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Informe um CNPJ válido (14 dígitos).',
          path: ['cnpj'],
        });
      }
    }

    const phoneDigits = unformatDigits(data.authorizedPhone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe um telefone válido (10 ou 11 dígitos).',
        path: ['authorizedPhone'],
      });
    }
  });

export type ShelterProfileInput = z.infer<typeof shelterProfileSchema>;
