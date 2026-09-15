# Vérifications — phase 1

- TypeScript strict : réussi.
- ESLint : réussi, aucune erreur ni avertissement.
- Tests métier, sécurité, Stripe et fabricant : 60 réussis (tarification, machines à états, providers mock/Stripe/Bajie injectés, mapping read-only, timeout/auth/réponses malformées, golden/failure flow, tenants, sessions, RBAC, webhooks, idempotence et réconciliation).
- Tests d’intégration : exécution du Worker de production avec une vraie base D1 locale isolée via Miniflare. Autorisation, double départ concurrent, retour inter-stations, double retour concurrent, reçu, rafraîchissement, listes Admin/Partner et refus d’accès entre tenants vérifiés.
- Injection de montant client rejetée par Zod. Origine étrangère rejetée. Échec d’éjection compensé par libération intégrale.
- Rendu HTML de production des onze pages publiques, du parcours QR et des portails : réussi.
- Build de production : réussi.
- Inspection visuelle interactive desktop/mobile : non réalisée, service de prévisualisation indisponible. Les styles responsive sont implémentés mais le rendu visuel n’est pas certifié.
- WebMCP : un outil de lecture des stations est enregistré si le navigateur le supporte ; validation en navigateur indisponible.
- PostgreSQL/Prisma : migrations et contraintes exécutées sur PGlite (moteur PostgreSQL), adaptateur Prisma généré et test d’intégration PostgreSQL disponible via `BATYEO_TEST_DATABASE_URL`.
- Le coordinator Stripe TEST est câblé dans l’API quand `PAYMENT_PROVIDER=stripe_test`; sans cette configuration, le runtime reste volontairement en mock.

Exécuter `pnpm test` puis `pnpm build && pnpm test:integration` pour reproduire les tests. L’intégration utilise une base isolée éphémère et ne modifie pas les données hébergées.
