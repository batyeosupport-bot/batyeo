# BATYEO Web — architecture

## Application fonctionnelle livrée

Monolithe TypeScript strict, React 19, routage App Router (Next-compatible Vinext), API REST `/api/core`, validation Zod et domaine indépendant de la persistance. Site public, parcours client QR, Admin, Partner, simulateur et client Expo mobile V1. Tous les établissements, paiements et matériels sont fictifs.

## Runtimes et frontières

Le runtime applicatif cible est Node/Next avec PostgreSQL et Prisma (`infrastructure/runtime.ts`, `infrastructure/postgres/repository.ts`). Il refuse une URL SQLite et ne bascule jamais silencieusement vers D1. Sites exécute un Worker de preview : son alias de build pointe explicitement vers `infrastructure/preview/d1-repository.ts`. Le domaine (`core`) ne connaît ni Prisma ni Drizzle.

## Frontières

- `core/pricing.ts` : centimes entiers, plafond, durée et commission.
- `core/state-machine.ts` : transitions explicitement autorisées.
- `core/rental.ts` : orchestration du parcours et contrôles RBAC/tenant.
- `core/providers.ts` : interfaces PaymentProvider et BatteryStationProvider, mocks purs.
- `core/repository.ts` : interface de repository indépendante de la base.
- `infrastructure/postgres/repository.ts` : mapping relationnel Prisma, transactions sérialisables, verrou `CoreRevision` et reprise des conflits.
- `infrastructure/preview/d1-repository.ts` : adaptateur D1/SQLite limité à la preview.
- `core/invariants.ts` : conservation financière, unicité des locations/batteries et liens de tenant, vérifiés avant écriture.
- `core/queries.ts` : projections, filtrage des données partenaires et suppression des secrets client.
- `core/security.ts` : sessions opaques hachées, PBKDF2, cookies HttpOnly, contrôle d’origine et limitation des tentatives.
- `core/mobile.ts` / `core/reconciliation.ts` : validation QR, stations proches, plans de notification et détection de divergences en lecture seule.
- `core/stripe.ts` : frontière Stripe TEST (PaymentIntent manual capture, idempotency, signature HMAC et ledger webhook).
- `core/stripe-coordinator.ts` : coordinator asynchrone qui sépare les commits domaine des appels réseau Stripe, compense une éjection échouée et règle la capture idempotente.
- `core/manufacturer.ts` : client HTTP et `ManufacturerBatteryStationProvider` Bajie/ChargeNow strictement READ-ONLY, mapping Zod et erreurs typées.
- `core/manufacturer-sync.ts` : registre multi-fabricant, synchronisation idempotente et tolérante par station, snapshots normalisés et divergences persistées sans écraser la vérité métier BATYEO.
- `POST /api/core/internal/manufacturer/sync` : point d’exécution protégé par `MANUFACTURER_SYNC_SECRET`, destiné à un scheduler staging/production. Aucun scheduler externe n’est créé par le repository.
- `POST /api/core/internal/rentals/capture-overdue-losses` : point d’exécution protégé par `OVERDUE_CAPTURE_SECRET`, destiné au même type de scheduler. Capture intégralement la caution (`core/rental.ts::markDepositLost`, état terminal `LOST`) pour toute location `OVERDUE` depuis plus de 48 h (`OVERDUE_LOSS_GRACE_MS`) — batterie jamais restituée. Aucun scheduler externe n’est créé par le repository.
- `app/api/core/[...path]/route.ts` : frontière HTTP, validation des entrées, réponses propres.
- `components/batyeo` : interfaces partagées et design system.

Le endpoint `POST /api/core/stripe/webhook` exige `STRIPE_WEBHOOK_SECRET`, vérifie la
signature Stripe, persiste chaque événement avec une clé unique `source + externalId`
et projette les statuts PaymentState de façon monotone lorsque `PAYMENT_PROVIDER=stripe_test`.
Sans secret, il refuse la requête ; aucun mode dégradé n'accepte une confirmation frontend.

## Atomicité et limites

Les écritures PostgreSQL sont sérialisables et verrouillent une ligne `CoreRevision`; les conflits de sérialisation sont rejoués jusqu’à cinq fois. Les contraintes, index uniques partiels et triggers de conservation financière sont dans les migrations Prisma. L’adaptateur D1 de preview conserve son compare-and-swap de révision. Le coordinator Stripe effectue les appels réseau hors transaction puis persiste chaque étape avec des clés d’idempotence déterministes. Une outbox durable et un worker de reprise restent recommandés avant la production.

La preview D1 conserve une lecture intégrale adaptée à la démonstration. PostgreSQL dispose de relations, index, contraintes et triggers relationnels, y compris `WebhookEvent` (unicité source/événement) ; les listes volumineuses devront encore être paginées avant la mise à l’échelle.

Le tarif est figé sur chaque location. 4 h représente le plafond initial de facturation, 48 h le délai de restitution. Le dépassement génère OVERDUE, sans majoration inventée. Les compteurs de démonstration peuvent avancer grâce à un décalage explicite, journalisé ; les événements gardent leur horodatage réel.

## Sécurité de démonstration

La publication reste privée. Les comptes et mots de passe de démonstration sont visibles volontairement, pour tester les rôles. Ils ne constituent pas un système de provisioning de production. Avant un lancement commercial : retirer les identifiants partagés, ajouter invitation/réinitialisation/révocation, secrets propres à l’environnement et durées de conservation, puis valider les documents juridiques et les flux réels.

La session opérateur expire après 8 h ; le cookie client après 7 jours. L’app mobile conserve uniquement un bearer client dans Expo SecureStore et le serveur reste la source de vérité. Un rafraîchissement ou redémarrage lit la location existante et ne crée rien. Les entrées financières du client ne sont jamais acceptées. Les requêtes natives sont explicitement marquées `x-batyeo-client: mobile`; les requêtes navigateur conservent le contrôle same-origin.

## Futures intégrations

L’app mobile appelle déjà la même API via une session client dédiée, QR natif, démarrage, suivi, sélection de station de retour et reçu. Les notifications restent no-op et la carte utilise un fallback liste. Bajie/ChargeNow est branché uniquement en lecture quand ses credentials sont présents ; toute méthode physique échoue explicitement. Aucun logiciel de borne, commande Bajie, TPE ou firmware n’est implémenté.
