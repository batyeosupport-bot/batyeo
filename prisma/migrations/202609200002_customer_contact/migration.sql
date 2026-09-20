-- Une adresse de contact facultative, donnee par le client au moment de la location.
-- Sans elle, un client n'est qu'un cookie : BATYEO pouvait capturer 20 euros de caution pour une
-- batterie non rendue sans avoir jamais eu le moyen de prevenir la personne, et un cookie efface
-- lui faisait perdre l'acces a sa propre location. Facultatif de bout en bout : refuser de la
-- donner ne doit jamais empecher de louer.
ALTER TABLE "Rental" ADD COLUMN "contactEmail" TEXT;
