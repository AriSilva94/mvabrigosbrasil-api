import { z } from 'zod';

export function unformatDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export const volunteerProfileSchema = z
  .object({
    name: z.string().min(1, 'Informe o nome social completo.'),
    telefone: z.string().min(1, 'Informe o telefone.'),
    profissao: z.string().min(1, 'Informe a profissão.'),
    faixa_etaria: z.string().min(1, 'Selecione a faixa etária.'),
    genero: z.string().min(1, 'Selecione o gênero.'),
    escolaridade: z.string().min(1, 'Selecione a escolaridade.'),
    estado: z.string().min(1, 'Informe o estado.'),
    cidade: z.string().min(1, 'Informe a cidade.'),
    disponibilidade: z.string().min(1, 'Selecione a disponibilidade de tempo.'),
    periodo: z.string().min(1, 'Selecione a disponibilidade de período.'),
    experiencia: z.string().min(1, 'Informe se tem experiência.'),
    atuacao: z.string().min(1, 'Selecione a forma de atuação.'),
    descricao: z.string().min(1, 'Descreva suas habilidades.'),
    comentarios: z.string().optional(),
    referralSource: z.string().min(1, 'Selecione como conheceu o projeto.'),
    acceptTerms: z.boolean().refine((value) => value === true, {
      message: 'Você deve aceitar os termos.',
    }),
  })
  .superRefine((data, ctx) => {
    const phoneDigits = unformatDigits(data.telefone);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe um telefone válido (10 ou 11 dígitos).',
        path: ['telefone'],
      });
    }

    if (/^\d+$/.test(data.profissao.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A profissão não pode conter apenas números.',
        path: ['profissao'],
      });
    }
  });

export type VolunteerProfileInput = z.infer<typeof volunteerProfileSchema>;
