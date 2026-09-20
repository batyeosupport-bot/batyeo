-- Rembourser un client et constater une contestation bancaire.
-- Jusqu'ici une capture etait definitive : aucune correction n'etait possible apres coup, ni
-- pour une erreur d'encaissement, ni pour une batterie retrouvee apres la perte des 48 h.
-- "refundedCents" est cumulatif et ne peut jamais depasser ce qui a ete encaisse ; le revenu net
-- se lit donc "capturedCents" - "refundedCents". "commissionCents" n'est pas recalcule : la part
-- du partenaire est figee dans le snapshot tarifaire de la location, et c'est precisement ce que
-- verifie le trigger batyeo_check_settlement.
-- "disputedAt" enregistre une contestation ouverte par la banque du client : BATYEO ne peut pas
-- la refuser, seulement la rendre visible.
ALTER TABLE "Payment" ADD COLUMN "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN "disputedAt" TIMESTAMP(3);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_bounds" CHECK ("refundedCents" >= 0 AND "refundedCents" <= "capturedCents");
