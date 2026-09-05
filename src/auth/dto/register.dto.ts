import { z } from 'zod';

// Presença/tipo apenas — trim/lower, o mínimo de 8 caracteres para a senha e
// a normalização de `registerType` (doc 05 §3.1) são responsabilidade de
// `AuthService.register`, que roda a mesma lógica independente de vir por
// HTTP ou ser chamado diretamente (unit tests). Aqui só garantimos o shape
// básico do body.
export const registerSchema = z.object({
  email: z.string(),
  password: z.string(),
  registerType: z.string().optional(),
  teamOnly: z.boolean().optional(),
});

export type RegisterDto = z.infer<typeof registerSchema>;
