-- Le taux de commission d'un partenaire devient une surcharge optionnelle de la grille tarifaire.
-- NULL = ce partenaire suit le taux de la grille active ; un entier = son taux propre.
-- Les partenaires existants passent a NULL : personne n'avait choisi 2000, c'etait le defaut de
-- la colonne. Comportement inchange tant que la grille reste a 2000, mais un futur changement de
-- taux global s'appliquera bien a eux au lieu de les laisser epingles en silence.
-- Aucune location deja enregistree n'est touchee : leur taux vit dans "pricingSnapshot".
ALTER TABLE "Partner" ALTER COLUMN "commissionBps" DROP DEFAULT;
ALTER TABLE "Partner" ALTER COLUMN "commissionBps" DROP NOT NULL;
UPDATE "Partner" SET "commissionBps"=NULL WHERE "commissionBps"=2000;
