-- Relax 12 columns that are NOT NULL on the target but genuinely nullable
-- in production (confirmed against the mv-mirror `\d` output). The target
-- schema was stricter than production and would reject writes production
-- allows. Zero nulls exist in the currently-imported dataset, so this is a
-- constraint-only change: no data is touched, no new NOT NULL is added.

ALTER TABLE "shelters" ALTER COLUMN "shelter_type" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "street" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "state" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "species" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "authorized_name" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "authorized_role" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "authorized_email" DROP NOT NULL;
ALTER TABLE "shelters" ALTER COLUMN "authorized_phone" DROP NOT NULL;

ALTER TABLE "vacancies" ALTER COLUMN "status" DROP NOT NULL;

ALTER TABLE "shelter_dynamics" ALTER COLUMN "reference_date" DROP NOT NULL;

ALTER TABLE "team_memberships" ALTER COLUMN "role" DROP NOT NULL;
