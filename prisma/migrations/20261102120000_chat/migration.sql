-- CreateTable
CREATE TABLE "chat_threads" (
    "id" UUID NOT NULL,
    "vacancy_id" UUID NOT NULL,
    "volunteer_profile_id" UUID NOT NULL,
    "shelter_profile_id" UUID NOT NULL,
    "shelter_id" UUID NOT NULL,
    "volunteer_id" UUID NOT NULL,
    "application_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participants" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "last_read_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "message_type" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT NOT NULL DEFAULT 'sent',
    "deleted_at" TIMESTAMPTZ,
    "edited_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_blocks" (
    "id" UUID NOT NULL,
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "thread_id" UUID,
    "message_id" UUID,
    "reported_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_threads_volunteer_profile_id_status_updated_at_idx" ON "chat_threads"("volunteer_profile_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "chat_threads_shelter_profile_id_status_updated_at_idx" ON "chat_threads"("shelter_profile_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "chat_threads_vacancy_id_idx" ON "chat_threads"("vacancy_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_threads_vacancy_id_volunteer_profile_id_key" ON "chat_threads"("vacancy_id", "volunteer_profile_id");

-- CreateIndex
CREATE INDEX "chat_participants_profile_id_is_active_idx" ON "chat_participants"("profile_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "chat_participants_thread_id_profile_id_key" ON "chat_participants"("thread_id", "profile_id");

-- CreateIndex
CREATE INDEX "chat_messages_thread_id_created_at_id_idx" ON "chat_messages"("thread_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_sender_id_idx" ON "chat_messages"("sender_id");

-- CreateIndex
CREATE INDEX "chat_blocks_blocked_id_idx" ON "chat_blocks"("blocked_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_blocks_blocker_id_blocked_id_key" ON "chat_blocks"("blocker_id", "blocked_id");

-- CreateIndex
CREATE INDEX "chat_reports_status_created_at_idx" ON "chat_reports"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "chat_reports_reporter_id_message_id_key" ON "chat_reports"("reporter_id", "message_id");

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_vacancy_id_fkey" FOREIGN KEY ("vacancy_id") REFERENCES "vacancies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_volunteer_profile_id_fkey" FOREIGN KEY ("volunteer_profile_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shelter_profile_id_fkey" FOREIGN KEY ("shelter_profile_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_shelter_id_fkey" FOREIGN KEY ("shelter_id") REFERENCES "shelters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_volunteer_id_fkey" FOREIGN KEY ("volunteer_id") REFERENCES "volunteers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "vacancy_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reported_user_id_fkey" FOREIGN KEY ("reported_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Regras de integridade do chat original (scripts/migrations/sql/05, 09)
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_status_check" CHECK ("status" IN ('active', 'archived', 'closed'));
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_role_check" CHECK ("role" IN ('volunteer', 'shelter'));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_content_length" CHECK (char_length("content") BETWEEN 1 AND 5000);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_type_check" CHECK ("message_type" IN ('text', 'system'));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_status_check" CHECK ("status" IN ('sent', 'read'));
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chk_no_self_block" CHECK ("blocker_id" <> "blocked_id");
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reason_length" CHECK (char_length("reason") BETWEEN 1 AND 1000);
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_status_check" CHECK ("status" IN ('pending', 'reviewed', 'dismissed', 'actioned'));
