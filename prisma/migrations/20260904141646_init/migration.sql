-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('abrigo', 'voluntario', 'gerente', 'admin');

-- CreateEnum
CREATE TYPE "UserOrigin" AS ENUM ('wordpress_migrated', 'supabase_native', 'admin_created');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "full_name" TEXT,
    "phone" TEXT,
    "role" "UserRole",
    "wp_user_id" INTEGER,
    "origin" "UserOrigin" NOT NULL DEFAULT 'supabase_native',
    "is_team_only" BOOLEAN NOT NULL DEFAULT false,
    "team_disabled" BOOLEAN NOT NULL DEFAULT false,
    "creator_profile_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelters" (
    "id" UUID NOT NULL,
    "wp_post_id" INTEGER,
    "profile_id" UUID,
    "shelter_type" TEXT NOT NULL,
    "cnpj" TEXT,
    "cpf" TEXT,
    "name" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT,
    "district" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "website" TEXT,
    "foundation_date" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "additional_species" JSONB NOT NULL DEFAULT '[]',
    "temporary_agreement" BOOLEAN,
    "referral_source" TEXT,
    "initial_dogs" INTEGER NOT NULL DEFAULT 0,
    "initial_cats" INTEGER NOT NULL DEFAULT 0,
    "initial_dogs_lt" INTEGER,
    "initial_cats_lt" INTEGER,
    "authorized_name" TEXT NOT NULL,
    "authorized_role" TEXT NOT NULL,
    "authorized_email" TEXT NOT NULL,
    "authorized_phone" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accept_terms" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "volunteers" (
    "id" UUID NOT NULL,
    "wp_post_id" INTEGER,
    "owner_profile_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "telefone" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "profissao" TEXT,
    "escolaridade" TEXT,
    "faixa_etaria" TEXT,
    "genero" TEXT,
    "experiencia" TEXT,
    "atuacao" TEXT,
    "disponibilidade" TEXT,
    "periodo" TEXT,
    "descricao" TEXT,
    "comentarios" TEXT,
    "referral_source" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "accept_terms" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "volunteers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancies" (
    "id" UUID NOT NULL,
    "wp_post_id" INTEGER,
    "shelter_id" UUID,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "periodo" TEXT,
    "carga_horaria" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "tipo_demanda" TEXT,
    "area_atuacao" TEXT,
    "quantidade" TEXT,
    "is_published" BOOLEAN,
    "habilidades_e_funcoes" TEXT,
    "perfil_dos_voluntarios" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vacancy_applications" (
    "id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "applied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vacancy_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelter_dynamics" (
    "id" UUID NOT NULL,
    "shelter_id" UUID NOT NULL,
    "wp_post_id" INTEGER,
    "kind" TEXT NOT NULL,
    "reference_date" DATE NOT NULL,
    "reference_period" TEXT,
    "dynamic_type" TEXT NOT NULL DEFAULT 'dinamica',
    "entradas_de_animais" INTEGER DEFAULT 0,
    "entradas_de_gatos" INTEGER DEFAULT 0,
    "adocoes_caes" INTEGER DEFAULT 0,
    "adocoes_gatos" INTEGER DEFAULT 0,
    "devolucoes_caes" INTEGER DEFAULT 0,
    "devolucoes_gatos" INTEGER DEFAULT 0,
    "eutanasias_caes" INTEGER DEFAULT 0,
    "eutanasias_gatos" INTEGER DEFAULT 0,
    "mortes_naturais_caes" INTEGER DEFAULT 0,
    "mortes_naturais_gatos" INTEGER DEFAULT 0,
    "doencas_caes" INTEGER DEFAULT 0,
    "doencas_gatos" INTEGER DEFAULT 0,
    "retorno_de_caes" INTEGER DEFAULT 0,
    "retorno_de_gatos" INTEGER DEFAULT 0,
    "retorno_local_caes" INTEGER DEFAULT 0,
    "retorno_local_gatos" INTEGER DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shelter_dynamics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelter_volunteers" (
    "id" UUID NOT NULL,
    "shelter_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "shelter_volunteers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shelter_history" (
    "id" UUID NOT NULL,
    "shelter_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "operation" TEXT NOT NULL,
    "old_data" JSONB,
    "new_data" JSONB,
    "changed_fields" TEXT[],
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,

    CONSTRAINT "shelter_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_memberships" (
    "id" UUID NOT NULL,
    "owner_profile_id" UUID,
    "owner_wp_user_id" INTEGER,
    "member_profile_id" UUID,
    "member_wp_user_id" INTEGER,
    "member_email" TEXT,
    "abrigo_post_id" INTEGER,
    "role" TEXT,
    "status" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_users_legacy" (
    "id" BIGINT NOT NULL,
    "user_login" VARCHAR(60) NOT NULL,
    "user_email" VARCHAR(100) NOT NULL,
    "user_pass" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(250),
    "migrated" BOOLEAN DEFAULT false,
    "migrated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wp_users_legacy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_users_raw" (
    "id" BIGSERIAL NOT NULL,
    "user_login" VARCHAR(60) NOT NULL,
    "user_pass" VARCHAR(255) NOT NULL,
    "user_nicename" VARCHAR(50) NOT NULL,
    "user_email" VARCHAR(100) NOT NULL,
    "user_url" VARCHAR(100),
    "user_registered" TIMESTAMP,
    "user_activation_key" VARCHAR(255),
    "user_status" INTEGER DEFAULT 0,
    "display_name" VARCHAR(250),

    CONSTRAINT "wp_users_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_posts_raw" (
    "id" BIGSERIAL NOT NULL,
    "post_author" BIGINT,
    "post_date" TIMESTAMP,
    "post_date_gmt" TIMESTAMP,
    "post_content" TEXT,
    "post_title" TEXT,
    "post_excerpt" TEXT,
    "post_status" VARCHAR(20),
    "comment_status" VARCHAR(20),
    "ping_status" VARCHAR(20),
    "post_password" VARCHAR(255),
    "post_name" VARCHAR(200),
    "to_ping" TEXT,
    "pinged" TEXT,
    "post_modified" TIMESTAMP,
    "post_modified_gmt" TIMESTAMP,
    "post_content_filtered" TEXT,
    "post_parent" BIGINT,
    "guid" VARCHAR(255),
    "menu_order" INTEGER,
    "post_type" VARCHAR(20),
    "post_mime_type" VARCHAR(100),
    "comment_count" BIGINT,

    CONSTRAINT "wp_posts_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wp_postmeta_raw" (
    "meta_id" BIGSERIAL NOT NULL,
    "post_id" BIGINT NOT NULL,
    "meta_key" VARCHAR(255),
    "meta_value" TEXT,

    CONSTRAINT "wp_postmeta_raw_pkey" PRIMARY KEY ("meta_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_wp_user_id_key" ON "users"("wp_user_id");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "users_creator_profile_id_idx" ON "users"("creator_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "shelters_wp_post_id_key" ON "shelters"("wp_post_id");

-- CreateIndex
CREATE INDEX "shelters_state_city_idx" ON "shelters"("state", "city");

-- CreateIndex
CREATE INDEX "shelters_active_idx" ON "shelters"("active");

-- CreateIndex
CREATE INDEX "shelters_species_idx" ON "shelters"("species");

-- CreateIndex
CREATE UNIQUE INDEX "shelters_profile_id_key" ON "shelters"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_wp_post_id_key" ON "volunteers"("wp_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "volunteers_slug_key" ON "volunteers"("slug");

-- CreateIndex
CREATE INDEX "volunteers_owner_profile_id_idx" ON "volunteers"("owner_profile_id");

-- CreateIndex
CREATE INDEX "volunteers_estado_cidade_idx" ON "volunteers"("estado", "cidade");

-- CreateIndex
CREATE INDEX "volunteers_is_public_idx" ON "volunteers"("is_public");

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_wp_post_id_key" ON "vacancies"("wp_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "vacancies_slug_key" ON "vacancies"("slug");

-- CreateIndex
CREATE INDEX "vacancies_shelter_id_idx" ON "vacancies"("shelter_id");

-- CreateIndex
CREATE INDEX "vacancies_status_idx" ON "vacancies"("status");

-- CreateIndex
CREATE INDEX "vacancies_status_is_published_idx" ON "vacancies"("status", "is_published");

-- CreateIndex
CREATE INDEX "vacancy_applications_vacancy_id_applied_at_idx" ON "vacancy_applications"("vacancy_id", "applied_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vacancy_applications_vacancy_id_volunteer_id_key" ON "vacancy_applications"("vacancy_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "shelter_dynamics_shelter_id_idx" ON "shelter_dynamics"("shelter_id");

-- CreateIndex
CREATE UNIQUE INDEX "shelter_dynamics_unique_ref" ON "shelter_dynamics"("shelter_id", "dynamic_type", "reference_period");

-- CreateIndex
CREATE UNIQUE INDEX "shelter_volunteers_shelter_id_volunteer_id_key" ON "shelter_volunteers"("shelter_id", "volunteer_id");

-- CreateIndex
CREATE INDEX "shelter_history_shelter_id_idx" ON "shelter_history"("shelter_id");

-- CreateIndex
CREATE INDEX "shelter_history_profile_id_idx" ON "shelter_history"("profile_id");

-- CreateIndex
CREATE INDEX "shelter_history_changed_at_idx" ON "shelter_history"("changed_at" DESC);

-- CreateIndex
CREATE INDEX "team_memberships_member_wp_user_id_role_status_idx" ON "team_memberships"("member_wp_user_id", "role", "status");

-- CreateIndex
CREATE INDEX "team_memberships_abrigo_post_id_idx" ON "team_memberships"("abrigo_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_memberships_owner_wp_user_id_member_wp_user_id_abrigo__key" ON "team_memberships"("owner_wp_user_id", "member_wp_user_id", "abrigo_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "wp_users_legacy_user_login_key" ON "wp_users_legacy"("user_login");

-- CreateIndex
CREATE UNIQUE INDEX "wp_users_legacy_user_email_key" ON "wp_users_legacy"("user_email");

-- CreateIndex
CREATE INDEX "wp_posts_raw_post_type_idx" ON "wp_posts_raw"("post_type");

-- CreateIndex
CREATE INDEX "wp_posts_raw_post_status_idx" ON "wp_posts_raw"("post_status");

-- CreateIndex
CREATE INDEX "wp_posts_raw_post_author_idx" ON "wp_posts_raw"("post_author");

-- CreateIndex
CREATE INDEX "wp_posts_raw_post_type_post_status_idx" ON "wp_posts_raw"("post_type", "post_status");

-- CreateIndex
CREATE INDEX "wp_postmeta_raw_post_id_idx" ON "wp_postmeta_raw"("post_id");

-- CreateIndex
CREATE INDEX "wp_postmeta_raw_meta_key_idx" ON "wp_postmeta_raw"("meta_key");

-- CreateIndex
CREATE INDEX "wp_postmeta_raw_post_id_meta_key_idx" ON "wp_postmeta_raw"("post_id", "meta_key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_creator_profile_id_fkey" FOREIGN KEY ("creator_profile_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelters" ADD CONSTRAINT "shelters_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "volunteers" ADD CONSTRAINT "volunteers_owner_profile_id_fkey" FOREIGN KEY ("owner_profile_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancies" ADD CONSTRAINT "vacancies_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "shelters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_applications" ADD CONSTRAINT "vacancy_applications_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vacancy_applications" ADD CONSTRAINT "vacancy_applications_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_dynamics" ADD CONSTRAINT "shelter_dynamics_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "shelters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_volunteers" ADD CONSTRAINT "shelter_volunteers_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "shelters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_volunteers" ADD CONSTRAINT "shelter_volunteers_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_history" ADD CONSTRAINT "shelter_history_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "shelters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_history" ADD CONSTRAINT "shelter_history_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shelter_history" ADD CONSTRAINT "shelter_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CHECKs do DDL original
ALTER TABLE shelters ADD CONSTRAINT shelters_initial_dogs_check CHECK (initial_dogs >= 0);
ALTER TABLE shelters ADD CONSTRAINT shelters_initial_cats_check CHECK (initial_cats >= 0);
ALTER TABLE shelter_history ADD CONSTRAINT shelter_history_operation_check
  CHECK (operation IN ('INSERT','UPDATE','DELETE','STATUS_CHANGE'));
CREATE UNIQUE INDEX users_email_lower_idx ON users (lower(email));

-- ⚠️ Adaptação Task 3 (achado durante verificação do Step 5, não copiado do spec):
-- `shelter_history.id` não tem default de banco (Prisma `@default(uuid())` só gera o valor
-- do lado do client). Como `shelter_history` é populada EXCLUSIVAMENTE pelo trigger
-- `log_shelter_changes()` abaixo — que nunca informa `id` no INSERT — todo INSERT/UPDATE/DELETE
-- em `shelters` (inclusive via Prisma/Nest, não só neste teste manual) violaria a constraint
-- NOT NULL de `shelter_history.id`. gen_random_uuid() é nativo do Postgres desde a v13 (sem
-- precisar da extensão pgcrypto), compatível com postgres:16-alpine.
ALTER TABLE shelter_history ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- updated_at automático (mesmo comportamento de set_timestamp_*; Prisma @updatedAt cobre só escritas via Prisma)
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_users_updated_at      BEFORE UPDATE ON users      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_shelters_updated_at   BEFORE UPDATE ON shelters   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_volunteers_updated_at BEFORE UPDATE ON volunteers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auditoria de abrigos: cópia de log_shelter_changes() com auth.uid() → GUC app.user_id
CREATE OR REPLACE FUNCTION log_shelter_changes() RETURNS trigger AS $$
DECLARE
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
  v_operation VARCHAR(20);
  v_old_data JSONB;
  v_new_data JSONB;
  v_actor UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
BEGIN
  IF (TG_OP = 'DELETE') THEN
    v_operation := 'DELETE'; v_old_data := row_to_json(OLD)::JSONB; v_new_data := NULL;
  ELSIF (TG_OP = 'INSERT') THEN
    v_operation := 'INSERT'; v_old_data := NULL; v_new_data := row_to_json(NEW)::JSONB;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF (OLD.active IS DISTINCT FROM NEW.active) AND (OLD.name = NEW.name) AND (OLD.cnpj IS NOT DISTINCT FROM NEW.cnpj) THEN
      v_operation := 'STATUS_CHANGE';
    ELSE
      v_operation := 'UPDATE';
    END IF;
    v_old_data := row_to_json(OLD)::JSONB; v_new_data := row_to_json(NEW)::JSONB;
    -- lista idêntica ao script 03
    IF (OLD.name IS DISTINCT FROM NEW.name) THEN v_changed_fields := array_append(v_changed_fields, 'name'); END IF;
    IF (OLD.shelter_type IS DISTINCT FROM NEW.shelter_type) THEN v_changed_fields := array_append(v_changed_fields, 'shelter_type'); END IF;
    IF (OLD.cnpj IS DISTINCT FROM NEW.cnpj) THEN v_changed_fields := array_append(v_changed_fields, 'cnpj'); END IF;
    IF (OLD.cpf IS DISTINCT FROM NEW.cpf) THEN v_changed_fields := array_append(v_changed_fields, 'cpf'); END IF;
    IF (OLD.street IS DISTINCT FROM NEW.street) THEN v_changed_fields := array_append(v_changed_fields, 'street'); END IF;
    IF (OLD.number IS DISTINCT FROM NEW.number) THEN v_changed_fields := array_append(v_changed_fields, 'number'); END IF;
    IF (OLD.district IS DISTINCT FROM NEW.district) THEN v_changed_fields := array_append(v_changed_fields, 'district'); END IF;
    IF (OLD.city IS DISTINCT FROM NEW.city) THEN v_changed_fields := array_append(v_changed_fields, 'city'); END IF;
    IF (OLD.state IS DISTINCT FROM NEW.state) THEN v_changed_fields := array_append(v_changed_fields, 'state'); END IF;
    IF (OLD.active IS DISTINCT FROM NEW.active) THEN v_changed_fields := array_append(v_changed_fields, 'active'); END IF;
    IF (OLD.authorized_name IS DISTINCT FROM NEW.authorized_name) THEN v_changed_fields := array_append(v_changed_fields, 'authorized_name'); END IF;
    IF (OLD.authorized_email IS DISTINCT FROM NEW.authorized_email) THEN v_changed_fields := array_append(v_changed_fields, 'authorized_email'); END IF;
    IF (OLD.authorized_phone IS DISTINCT FROM NEW.authorized_phone) THEN v_changed_fields := array_append(v_changed_fields, 'authorized_phone'); END IF;
  END IF;

  INSERT INTO shelter_history (shelter_id, profile_id, operation, old_data, new_data, changed_fields, changed_by)
  VALUES (COALESCE(NEW.id, OLD.id), COALESCE(NEW.profile_id, OLD.profile_id), v_operation, v_old_data, v_new_data, v_changed_fields, v_actor);
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shelter_history
  AFTER INSERT OR UPDATE OR DELETE ON shelters
  FOR EACH ROW EXECUTE FUNCTION log_shelter_changes();
