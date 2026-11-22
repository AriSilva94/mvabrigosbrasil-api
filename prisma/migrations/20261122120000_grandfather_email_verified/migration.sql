-- Contas anteriores à verificação de e-mail continuam verificadas.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
