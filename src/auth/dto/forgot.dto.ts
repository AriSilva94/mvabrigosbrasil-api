import { z } from 'zod';

// Presença/tipo apenas — a normalização do e-mail e o fato de nunca revelar
// se o usuário existe (doc 03 §10) são responsabilidade de
// `AuthService.forgotPassword`.
export const forgotPasswordSchema = z.object({
  email: z.string(),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;
