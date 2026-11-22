-- Contas anteriores à verificação de e-mail continuam verificadas; só os
-- cadastros novos precisam confirmar o e-mail antes de entrar.
UPDATE "users" SET "email_verified" = true WHERE "email_verified" = false;
