# Brief de reprise — session courte, pour clôturer

> À coller tel quel au démarrage d'une nouvelle session Claude Code.
> Rédigé le 2026-09-18 à la fin d'une session qui a livré les commits `c91351b` → `72539af`.

---

Tu reprends le projet BATYEO seul. Je pars, donc **ne me pose aucune question** : prends les décisions raisonnables toi-même, documente-les dans tes commits, et laisse un récapitulatif honnête à la fin.

**Cette session est courte et bornée.** Le blocage externe (voir plus bas) n'a pas bougé et ne bougera pas pendant que tu travailles : n'essaie pas de le contourner, ne réinvente pas un chemin autour. Fais la liste de tâches ci-dessous dans l'ordre, vérifie chacune par compilation/exécution réelle (jamais par conviction), commit et push au fur et à mesure, puis **arrête-toi** avec un récapitulatif — ne pars pas en exploration ouverte à la recherche d'autres chantiers.

## Le projet

BATYEO loue des batteries externes dans des bornes physiques installées chez des commerçants (bars, hôtels). Le client scanne un QR ou paie par carte sur la borne, prend une batterie, la rend sous 48 h.

Repo à `/Users/anismeslin/Developer/BATYEO` (monorepo) :
- **`core/`** — domaine métier, très testé (199 tests au dernier commit).
- **`server/http.ts`** — toutes les routes API.
- **`app/` + `components/batyeo/`** — site public Next.js, portail admin/partenaire, page kiosque `/kiosk/[publicId]`.
- **`mobile/`** — app client Expo/React Native (npm, pas pnpm).
- **`runtime/`** — app kiosque Android native en Kotlin qui tourne **sur la borne**.

## Où en est le projet (lis avant d'agir)

Les trois derniers jours de sessions ont livré, dans l'ordre : le squelette runtime Android, la liaison borne↔back-office (config versionnée, i18n, médias, heartbeat, appairage), le lecteur Stripe Terminal, un audit complet de l'écosystème, la machinerie de réconciliation d'un résultat physique d'éjection inconnu (avec sa route de résolution admin), la sortie de l'appel d'éjection hors transaction (prérequis technique pour un vrai provider fabricant), et la descente de la Location Stripe Terminal jusqu'à la borne.

**Statut réel, pas optimiste** :
- Backend : `READY` — testé, typé, compile.
- Web : `READY` — compile et testé au niveau HTTP, **jamais ouvert dans un vrai navigateur** cette session ni la précédente (voir tâche 2 ci-dessous, c'est le trou le plus net côté web).
- Mobile (app cliente Expo) : build + lancement **iOS réellement vérifiés sur simulateur** (capture d'écran à l'appui). Build **Android jamais tenté** pour cette app précise (à ne pas confondre avec `runtime/`, le kiosque Android, qui lui a été build avec succès plusieurs fois).
- PostgreSQL / Bajie / App Store / Google Play : `BLOCKED`, sans changement possible sans action externe.

## Le blocage externe qui n'a pas bougé — ne perds pas de temps dessus

Aucun code ne peut faire sortir une batterie de la borne : les credentials marchand ChargeNow sont vides, et surtout **personne n'a confirmé que l'API du fabricant expose une commande d'éjection** (seuls deux endpoints de lecture sont documentés). Détail dans `docs/EXTERNAL_BLOCKERS.md`. Tant que ce point n'a pas bougé côté humain, la route B est bloquée à 100 % quel que soit le code écrit. `core/stripe-coordinator.ts` expose déjà l'interface `AsyncBatteryEjector`, le point d'ancrage prêt pour le jour où un vrai provider existera — ne l'implémente pas avec un endpoint deviné.

## Interdits absolus (inchangés)

- **`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` doit rester `false`.** Le code refuse volontairement de démarrer sinon.
- **Ne lance jamais le serveur de dev directement contre `.env`** : il pointe sur l'instance Supabase de **production**. Toute tâche qui a besoin de faire tourner l'app web doit d'abord s'isoler (voir tâche 2).
- **Ne commit aucun secret.**
- N'ajoute pas de dépendance lourde sans raison.

## Tâches, dans l'ordre — arrête-toi une fois faites

### 1. Vérifier le build Android de l'app mobile cliente (`mobile/`, pas `runtime/`)
Personne ne l'a jamais tenté. Depuis `mobile/` :
```bash
npx tsc --noEmit
npx expo run:android
```
Si aucun émulateur/device Android n'est configuré sur cette machine, dis-le explicitement plutôt que d'inventer un résultat, et vérifie au minimum que le build Gradle sous-jacent compile (`cd android && ./gradlew assembleDebug` une fois le projet natif généré par `expo prebuild` si nécessaire).

### 2. Ouvrir enfin le web dans un vrai navigateur, sans toucher à la prod
C'est la vérification la plus utile et la plus repoussée depuis le début. Isole-toi d'abord :
1. Vérifie si un Postgres local est disponible (`pg_isready`, ou Docker : `docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=postgres postgres:16`).
2. Si oui : configure un `DATABASE_URL` **local** (jamais celui de `.env`), lance `pnpm prisma migrate deploy`, seed avec `pnpm db:seed:demo`, puis `pnpm dev:postgres`.
3. Ouvre le site, le parcours `/rent/<station-demo>`, la page `/kiosk/<publicId>`, et le portail `/admin` — en particulier le nouveau panneau « Locations Stripe Terminal » dans Admin → Affichage et le bouton « Réconcilier » dans Monitoring (jamais vus dans un navigateur, seulement compilés).
4. Si aucun Postgres local n'est réalistement disponible sur cette machine dans un temps raisonnable, **dis-le clairement** plutôt que d'y passer la session, et documente précisément ce qui resterait à faire pour qu'une session future puisse le faire.

### 3. Repasse la chaîne de vérification complète et corrige ce qui casse
```bash
cd /Users/anismeslin/Developer/BATYEO
npx tsc --noEmit -p tsconfig.json
node scripts/test.mjs
npx eslint . --ignore-pattern dist --ignore-pattern .next --ignore-pattern .test-build --ignore-pattern mobile
npx next build --webpack   # puis : git checkout tsconfig.json (le build le modifie tout seul)
node --import tsx scripts/release-readiness.ts
```
Android runtime (kiosque) :
```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$PATH"
cd runtime && ./gradlew :app:assembleDebug
```

### 4. Si tout ce qui précède est vert et qu'il te reste du temps
Ne va pas chercher un nouveau chantier de ton propre chef. Relis `docs/EXTERNAL_BLOCKERS.md` et `docs/RUNBOOK_STAGING_GO_LIVE.md` pour vérifier qu'ils reflètent toujours exactement l'état du code, corrige-les si un détail a dérivé, et arrête-toi là.

## Méthode de travail attendue (inchangée)

- **Vérifie par compilation/exécution réelle, jamais par conviction.**
- **Commit et push au fur et à mesure** sur `main` (`git push origin main`).
- Termine les messages de commit par la ligne d'attribution que tes instructions système te donnent pour cette session (elle varie selon le modèle qui t'exécute — ne la devine pas, utilise celle qui t'est fournie).
- **Respecte le style du repo** : `core/` et `server/` sont volontairement en lignes très denses. Ne reformate pas ce que tu ne touches pas.
- **Commentaires rares**, uniquement le *pourquoi* non évident.
- **Sois honnête sur le non-testé.** Rien n'a jamais tourné sur la borne physique. Écris « vérifié à la compilation » ou « vérifié à l'exécution » selon la vérité, jamais « ça marche » par défaut.

## À la fin

Un récapitulatif court : ce qui est fait et vérifié (précise compilation vs exécution réelle), les décisions prises seul, ce qui reste bloqué et pourquoi. Ne relance pas de nouvelle liste de chantiers — le blocage externe reste le seul vrai sujet tant qu'il n'a pas bougé.
