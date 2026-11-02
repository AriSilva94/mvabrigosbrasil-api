import { z } from 'zod';

export const vacancyFormSchema = z.object({
  post_abrigo: z.string().optional(),
  post_estado: z.string().optional(),
  post_cidade: z.string().optional(),
  post_title: z.string().min(1, 'Informe o título da vaga.'),
  post_periodo: z.string().min(1, 'Selecione o período.'),
  post_carga: z.string().min(1, 'Selecione a carga horária.'),
  post_tipo_demanda: z.string().min(1, 'Selecione o tipo de demanda.'),
  post_area_atuacao: z.string().min(1, 'Selecione a área de atuação.'),
  post_quantidade: z.string().min(1, 'Informe a quantidade de vagas.'),
  post_is_published: z.boolean(),
  post_content: z.string().min(1, 'Descreva a vaga.'),
  post_habilidades_e_funcoes: z
    .string()
    .min(1, 'Descreva as habilidades e funções.'),
  post_perfil_dos_voluntarios: z
    .string()
    .min(1, 'Descreva o perfil dos voluntários.'),
});

export type VacancyFormInput = z.infer<typeof vacancyFormSchema>;
