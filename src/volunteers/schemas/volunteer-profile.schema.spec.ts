import { volunteerProfileSchema } from './volunteer-profile.schema';

const validPayload = {
  name: 'Maria Silva',
  telefone: '(41) 99999-1234',
  profissao: 'Veterinaria',
  faixa_etaria: '25-34',
  genero: 'Feminino',
  escolaridade: 'Superior completo',
  estado: 'PR',
  cidade: 'Curitiba',
  disponibilidade: 'Semanal',
  periodo: 'Matutino',
  experiencia: 'Sim',
  atuacao: 'Presencial',
  descricao: 'Cuidados com animais',
  comentarios: 'Disponivel aos sabados',
  referralSource: 'Instagram',
  acceptTerms: true,
};

describe('volunteerProfileSchema', () => {
  it('accepts the literal frontend payload', () => {
    expect(volunteerProfileSchema.safeParse(validPayload).success).toBe(true);
  });

  it.each([
    ['name', 'Informe o nome social completo.'],
    ['telefone', 'Informe o telefone.'],
    ['profissao', 'Informe a profissão.'],
    ['faixa_etaria', 'Selecione a faixa etária.'],
    ['genero', 'Selecione o gênero.'],
    ['escolaridade', 'Selecione a escolaridade.'],
    ['estado', 'Informe o estado.'],
    ['cidade', 'Informe a cidade.'],
    ['disponibilidade', 'Selecione a disponibilidade de tempo.'],
    ['periodo', 'Selecione a disponibilidade de período.'],
    ['experiencia', 'Informe se tem experiência.'],
    ['atuacao', 'Selecione a forma de atuação.'],
    ['descricao', 'Descreva suas habilidades.'],
    ['referralSource', 'Selecione como conheceu o projeto.'],
  ])('keeps the required message for %s', (field, message) => {
    const parsed = volunteerProfileSchema.safeParse({
      ...validPayload,
      [field]: '',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(message);
    }
  });

  it('requires accepted terms with the literal message', () => {
    const parsed = volunteerProfileSchema.safeParse({
      ...validPayload,
      acceptTerms: false,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        'Você deve aceitar os termos.',
      );
    }
  });

  it.each(['(41) 9999-123', '(41) 99999-12345'])(
    'rejects invalid phone length for %s',
    (telefone) => {
      const parsed = volunteerProfileSchema.safeParse({
        ...validPayload,
        telefone,
      });

      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe(
          'Informe um telefone válido (10 ou 11 dígitos).',
        );
      }
    },
  );

  it('rejects a profession containing only numbers', () => {
    const parsed = volunteerProfileSchema.safeParse({
      ...validPayload,
      profissao: ' 12345 ',
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        'A profissão não pode conter apenas números.',
      );
    }
  });
});
