-- Bootstrap for the disposable Supabase mirror (docker-compose.mirror.yml).
--
-- The dump (schema.sql/data.sql) assumes a real Supabase instance where the
-- "extensions" and "auth" schemas, and the auth.users table, already exist.
-- A plain postgres:16-alpine image has none of that, so we create the
-- minimal scaffolding here before restoring the dump, otherwise:
--   - CREATE TABLE statements whose DEFAULT calls extensions.uuid_generate_v4()
--     fail outright (the whole CREATE TABLE aborts, e.g. public.deletion_flags).
--   - COPY "auth"."users" ... fails because schema "auth" does not exist,
--     which also blocks the public.profiles FK to auth.users(id).
--
-- Schema/DDL only. No data rows.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    instance_id uuid,
    id uuid PRIMARY KEY,
    aud varchar(255),
    role varchar(255),
    email varchar(255),
    encrypted_password varchar(255),
    email_confirmed_at timestamptz,
    invited_at timestamptz,
    confirmation_token varchar(255),
    confirmation_sent_at timestamptz,
    recovery_token varchar(255),
    recovery_sent_at timestamptz,
    email_change_token_new varchar(255),
    email_change varchar(255),
    email_change_sent_at timestamptz,
    last_sign_in_at timestamptz,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamptz,
    updated_at timestamptz,
    phone text,
    phone_confirmed_at timestamptz,
    phone_change text,
    phone_change_token varchar(255),
    phone_change_sent_at timestamptz,
    email_change_token_current varchar(255),
    email_change_confirm_status smallint,
    banned_until timestamptz,
    reauthentication_token varchar(255),
    reauthentication_sent_at timestamptz,
    is_sso_user boolean,
    deleted_at timestamptz,
    is_anonymous boolean
);
