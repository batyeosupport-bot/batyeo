# BATYEO — résumé du projet

BATYEO est un écosystème de location de batteries externes composé d’un site public, d’un parcours de location Web, d’une application mobile Expo, d’un portail Admin, d’un portail Partner et d’un Core métier commun.

## Parcours principal

Le client ouvre le QR d’une station, consulte sa disponibilité et le tarif, accepte les conditions, autorise la caution, récupère une batterie, puis la restitue dans une station compatible. Le Core calcule le prix final, clôture la location et produit les données du reçu. Les paiements et les stations restent simulés tant que les services externes ne sont pas activés.

## Architecture

- `app/` et `components/` : site public, location Web, Admin et Partner.
- `core/` : tarification, location, états, sécurité, fournisseurs et réconciliation.
- `server/` : API HTTP utilisée par tous les clients.
- `mobile/` : application Expo/React Native iOS, Android et Web.
- `infrastructure/` : adaptateurs de persistance et fournisseurs externes.
- `prisma/` et `drizzle/` : schémas et migrations PostgreSQL/D1.
- `tests/` : tests métier, sécurité, concurrence, providers et mobile.
- `docs/` : architecture, procédures de staging, hardware et publication mobile.

Le domaine reste indépendant de React, Expo, Stripe, Bajie et de la base de données. Les clients n’envoient jamais un prix ou un résultat de paiement comme source de vérité.

## Fonctionnalités disponibles

- Site public BATYEO avec navigation, stations, tarifs, support et documents de démonstration.
- Location Web avec reprise après actualisation, états d’erreur et reçu.
- Admin avec stations, batteries, locations, paiements, support, monitoring et simulateur.
- Partner avec isolation par partenaire.
- Pricing Engine : 2 € par heure commencée, plafond 8 €, caution 20 €, délai de retour 48 h.
- Rental Engine et Payment State Machine avec transitions et opérations idempotentes.
- MockPaymentProvider et MockBatteryStationProvider pour les démonstrations.
- StripePaymentProvider en mode TEST, sans activation Live.
- Provider Bajie/ChargeNow en lecture seule, sans commande physique.
- Synchronisation fabricant, réconciliation, alertes et scheduler préparés.
- Station Runtime, enrôlement, diagnostics, heartbeat, cache hors ligne et garde-fous hardware.
- Application mobile : accueil, QR, stations, disponibilité, location, reprise de session, retour, reçu, historique, support et profil.

## Lancement Web

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

La base de preview utilise la configuration Sites/D1. PostgreSQL est la cible du staging et de la production.

## Lancement mobile

```bash
cd mobile
npm install
cp .env.example .env
npm run web
```

Pour un téléphone, `EXPO_PUBLIC_BATYEO_CORE_URL` doit viser une API BATYEO accessible depuis l’appareil. Les secrets Stripe, Bajie et Admin ne doivent jamais être placés dans les variables publiques Expo.

## Vérifications disponibles

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:sql
pnpm build
pnpm test:integration

cd mobile
npm run typecheck
npx expo install --check
npx expo-doctor
npm run build:web
```

Les tests sur caméra, GPS, notifications, liens universels et comportement après fermeture doivent être exécutés sur de vrais appareils. Un build Android local nécessite Android SDK/ADB. Un build iOS local nécessite macOS/Xcode ou un build EAS avec les accès Apple.

## Accès externes encore nécessaires

- URL PostgreSQL de staging pour valider les migrations sur le réseau réel.
- Clés Stripe TEST pour vérifier une transaction externe complète.
- Credentials Bajie pour valider les lectures fabricant réelles.
- Première borne et documentation de son OS pour les tests hardware.
- Comptes et certificats Apple/Google pour les builds signés et la distribution.

Les actions physiques, Stripe Live et les simulateurs de production restent désactivés par défaut.
