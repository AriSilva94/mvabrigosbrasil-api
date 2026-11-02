import { vacancyFormSchema } from './vacancy.schema';

describe('vacancyFormSchema', () => {
  const valid = {
    post_title: 'Cuidador',
    post_periodo: 'Matutino',
    post_carga: '4h',
    post_tipo_demanda: 'Recorrente',
    post_area_atuacao: 'Cuidados',
    post_quantidade: '2',
    post_is_published: true,
    post_content: 'Descrição',
    post_habilidades_e_funcoes: 'Cuidar',
    post_perfil_dos_voluntarios: 'Adultos',
  };

  it('accepts the literal legacy payload', () => {
    expect(vacancyFormSchema.safeParse(valid).success).toBe(true);
  });

  it('keeps the first literal validation message', () => {
    const parsed = vacancyFormSchema.safeParse({
      ...valid,
      post_title: '',
      post_periodo: '',
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe('Informe o título da vaga.');
    }
  });
});
