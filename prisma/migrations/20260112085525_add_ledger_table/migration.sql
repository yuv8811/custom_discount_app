-- CreateTable
CREATE TABLE "GiftCardLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "discountCode" TEXT NOT NULL,
    "discountAmount" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "redeemed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardLedger_discountCode_key" ON "GiftCardLedger"("discountCode");
