-- CreateEnum
CREATE TYPE "TutoringSessionStatus" AS ENUM ('SCHEDULED', 'LIVE', 'ENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SessionVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "SessionParticipantRole" AS ENUM ('TUTOR', 'STUDENT', 'OBSERVER');

-- CreateEnum
CREATE TYPE "SessionEventType" AS ENUM ('SESSION_CREATED', 'SESSION_CANCELLED', 'PARTICIPANT_INVITED', 'ROOM_STARTED', 'ROOM_FINISHED', 'PARTICIPANT_JOINED', 'PARTICIPANT_LEFT', 'PARTICIPANT_CONNECTION_ABORTED', 'NOTE_ADDED');

-- CreateEnum
CREATE TYPE "SessionEventSource" AS ENUM ('LIVEKIT_WEBHOOK', 'API', 'SYSTEM');

-- CreateTable
CREATE TABLE "TutoringSession" (
    "id" TEXT NOT NULL,
    "roomName" TEXT NOT NULL,
    "roomSid" TEXT,
    "status" "TutoringSessionStatus" NOT NULL DEFAULT 'SCHEDULED',
    "visibility" "SessionVisibility" NOT NULL DEFAULT 'PRIVATE',
    "language" "Language" NOT NULL DEFAULT 'FR',
    "title" TEXT,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSeconds" INTEGER,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "TutoringSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionParticipant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SessionParticipantRole" NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstJoinedAt" TIMESTAMP(3),
    "lastLeftAt" TIMESTAMP(3),
    "totalSeconds" INTEGER,

    CONSTRAINT "SessionParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "SessionEventType" NOT NULL,
    "source" "SessionEventSource" NOT NULL,
    "actorId" TEXT,
    "externalId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB,

    CONSTRAINT "SessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TutoringSession_roomName_key" ON "TutoringSession"("roomName");

-- CreateIndex
CREATE INDEX "TutoringSession_status_startedAt_idx" ON "TutoringSession"("status", "startedAt");

-- CreateIndex
CREATE INDEX "TutoringSession_createdById_scheduledFor_idx" ON "TutoringSession"("createdById", "scheduledFor");

-- CreateIndex
CREATE INDEX "TutoringSession_startedAt_idx" ON "TutoringSession"("startedAt");

-- CreateIndex
CREATE INDEX "SessionParticipant_userId_idx" ON "SessionParticipant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionParticipant_sessionId_userId_key" ON "SessionParticipant"("sessionId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionEvent_externalId_key" ON "SessionEvent"("externalId");

-- CreateIndex
CREATE INDEX "SessionEvent_sessionId_occurredAt_idx" ON "SessionEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "SessionEvent_type_occurredAt_idx" ON "SessionEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "SessionEvent_actorId_occurredAt_idx" ON "SessionEvent"("actorId", "occurredAt");

-- AddForeignKey
ALTER TABLE "TutoringSession" ADD CONSTRAINT "TutoringSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TutoringSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionParticipant" ADD CONSTRAINT "SessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TutoringSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionEvent" ADD CONSTRAINT "SessionEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
