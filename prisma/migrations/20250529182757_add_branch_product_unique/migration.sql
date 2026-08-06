/*
  Warnings:

  - A unique constraint covering the columns `[branchId,productId]` on the table `BranchStock` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "BranchStock_branchId_productId_key" ON "BranchStock"("branchId", "productId");
