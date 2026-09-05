import { z } from 'zod';

// Presença apenas — trim/lower e a mensagem 400 exata (doc 05 §3.1) são
// responsabilidade de `AuthService.login`, que roda o mesmo schema de
// normalização independente de vir por HTTP ou ser chamado diretamente
// (unit tests). Aqui só garantimos que o body tem as duas chaves como string.
export const loginSchema = z.object({
  email: z.string(),
  password: z.string(),
});

export type LoginDto = z.infer<typeof loginSchema>;
