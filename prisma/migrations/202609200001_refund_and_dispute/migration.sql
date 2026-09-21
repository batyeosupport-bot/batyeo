-- Rembourser un client et constater une contestation bancaire.
-- Jusqu'ici une capture etait definitive : aucune correction n'etait possible apres coup, ni
-- pour une erreur d'encaissement, ni pour une batterie retrouvee apres la perte des 48 h.
-- "refundedCents" est cumulatif et ne peut jamais depasser ce qui a ete encaisse ; le revenu net
-- se lit donc "capturedCents" - "refundedCents". "commissionCents" n'est pas recalcule : la part
-- du partenaire est figee dans le snapshot tarifaire de la location, et c'est precisement ce que
-- verifie le trigger batyeo_check_settlement.
-- "disputedAt" enregistre une contestation ouverte par la banque du client : BATYEO ne peut pas
-- la refuser, seulement la rendre visible.
-- Rejouable sans erreur (IF NOT EXISTS) : elle peut etre collee dans l'editeur SQL de Supabase
-- puis rejouee plus tard par `prisma migrate deploy` sans conflit.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "refundedCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "disputedAt" TIMESTAMP(3);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_refund_bounds') THEN
  ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_bounds" CHECK ("refundedCents" >= 0 AND "refundedCents" <= "capturedCents");
 END IF;
END $$;
