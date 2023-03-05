-- CreateTable
CREATE TABLE "vrc_name_list" (
    "guild_id" TEXT NOT NULL,
    "guild_name" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "vrc_name" TEXT NOT NULL,
    "change_remaining" INTEGER NOT NULL,
    "last_change_day" TEXT NOT NULL,

    PRIMARY KEY ("guild_id", "user_id")
);

-- CreateTable
CREATE TABLE "text_links" (
    "guild_id" TEXT NOT NULL PRIMARY KEY,
    "guild_name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "text_link" TEXT NOT NULL,
    "create_date" TEXT NOT NULL,
    "update_date" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "setting" (
    "guild_id" TEXT NOT NULL PRIMARY KEY,
    "guild_name" TEXT NOT NULL,
    "vrc_name_change_limit_per_day" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "text_links_fileName_key" ON "text_links"("fileName");

-- CreateIndex
CREATE UNIQUE INDEX "text_links_text_link_key" ON "text_links"("text_link");
