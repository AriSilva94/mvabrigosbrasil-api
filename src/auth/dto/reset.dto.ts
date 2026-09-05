import { z } from 'zod';

// Presença/tipo apenas — trim e o mínimo de 6 caracteres para a senha (doc
// 03 §10, paridade com `ResetPasswordForm` do front) são responsabilidade
// de `AuthService.resetPassword`.
export const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string(),
});

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;
