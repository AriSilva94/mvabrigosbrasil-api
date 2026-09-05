import { z } from 'zod';

// Presença/tipo apenas — trim, o mínimo de 6 caracteres para a nova senha e
// a verificação da senha atual (doc 03 §10) são responsabilidade de
// `AuthService.changePassword`.
export const changePasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
