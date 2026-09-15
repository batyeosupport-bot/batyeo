# BATYEO — Web Ecosystem, phase 1

Produit de démonstration fonctionnel : site public, location web QR, Admin, Partner, moteurs métier et simulateurs. Aucun paiement ni matériel réel.

## Démarrer

Node 22.13+ et pnpm (version du champ packageManager).

```bash
pnpm install --frozen-lockfile
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_slim_jackal.sql
pnpm dev
```

Dans l’environnement Sites géré, utiliser le superviseur de prévisualisation fourni. Les données fictives sont initialisées automatiquement au premier accès à la base migrée. Les migrations sont schéma seulement ; le seed applicatif est transactionnel et idempotent.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Accès de démonstration

| Espace | Email | Mot de passe |
| --- | --- | --- |
| Admin | admin@batyeo.demo | BatyeoDemo!2026 |
| Partner A | partner@batyeo.demo | BatyeoDemo!2026 |
| Partner B | partner-b@batyeo.demo | BatyeoDemo!2026 |

Autres comptes : operations@batyeo.demo, finance@batyeo.demo, support@batyeo.demo, partner_user@batyeo.demo (même mot de passe). Les rôles sont contrôlés côté serveur. Les comptes partenaires A et B sont isolés.

## Démonstration du golden flow

1. Ouvrir `/rent/paris-demo` (équivalent du scan QR).
2. Accepter les conditions et prendre une batterie. Autorisation mock 20 €, éjection, ACTIVE.
3. Ouvrir `/admin` dans un deuxième onglet ; vérifier la location et sa timeline.
4. `/admin/simulator` : choisir une station avec un emplacement libre, puis la location.
5. Avancer de 61 minutes si souhaité, puis « Rendre la batterie ».
6. L’onglet client affiche automatiquement le reçu. Admin et Partner se mettent à jour.

Échec : choisir « Échec d’éjection » ou « Délai fournisseur dépassé » avant le départ. L’autorisation est libérée, la location passe à EJECTION_FAILED, la batterie reste en station. Revenir à « Succès normal » pour rétablir le fonctionnement.

Le bouton d’éjection simulée ne représente aucune commande hardware. Les liens QR sont opérationnels ; aucun QR imprimable n’est généré dans cette version.

## Stockage et limites

Le runtime Node/PostgreSQL utilise Prisma (`infrastructure/postgres`) et exige `DATABASE_URL`. L’adaptateur D1/SQLite (`infrastructure/preview`) est réservé à la prévisualisation Sites. Le moteur métier ne dépend d’aucune base. Pour initialiser PostgreSQL : `pnpm prisma:generate`, `pnpm db:migrate`, puis `BATYEO_ALLOW_DEMO_SEED=true BATYEO_DEMO_PASSWORD='mot-de-passe-de-16-caracteres' pnpm db:seed:demo`. Voir `docs/ARCHITECTURE.md` pour les garanties transactionnelles et les limites.

## API

GET `public`, `customer`, `me`, `dashboard`, `rentals/:id` sous `/api/core`.
POST `login`, `logout`, `start`, `simulate`, `pricing`, `ticket`, `resolve-ticket`, `settings`, `stripe/webhook` (Stripe TEST signé uniquement).
Toutes les mutations exigent JSON et une origine identique. `start` exige un cookie client préétabli, un UUID d’idempotence et l’acceptation explicite des conditions. Ni prix ni caution ne sont acceptés depuis le client. Les erreurs ne révèlent pas de stack trace.

## Design

Vert forêt, accent citron, fond clair, typographie expressive. Tokens et composants partagés ; focus visible, mouvement réduit, formulaires étiquetés, états de chargement, erreurs, résultats vides et reçus. Les visuels produit sont des concepts générés, pas des photographies de matériel commercial disponible.
