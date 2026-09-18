# Brief de reprise — état après la session de clôture du 2026-09-18

> Rédigé le 2026-09-18 à la fin de la session de clôture qui a vérifié à l'exécution
> ce qui n'avait jusque-là été vérifié qu'à la compilation.

---

## Le projet

BATYEO loue des batteries externes dans des bornes physiques installées chez des commerçants (bars, hôtels). Le client scanne un QR ou paie par carte sur la borne, prend une batterie, la rend sous 48 h.

Repo à `/Users/anismeslin/Developer/BATYEO` (monorepo) :
- **`core/`** — domaine métier, très testé (199 tests, tous passants).
- **`server/http.ts`** — toutes les routes API.
- **`app/` + `components/batyeo/`** — site public Next.js, portail admin/partenaire, page kiosque `/kiosk/[publicId]`.
- **`mobile/`** — app client Expo/React Native (npm, pas pnpm).
- **`runtime/`** — app kiosque Android native en Kotlin qui tourne **sur la borne**.

## Où en est le projet

**Statut réel, pas optimiste** — cette session a fait passer le web et le mobile Android de « vérifié à la compilation » à « vérifié à l'exécution » :

- Backend : `READY` — testé (199/199), typé, compile.
- Web : `READY` — **ouvert dans un vrai navigateur cette session** (Playwright/Chromium, one-shot, non ajouté au projet). Vérifié : `/`, `/rent/paris-demo`, `/kiosk/paris-demo`, `/admin` (login), `/admin/display` (panneau « Locations Stripe Terminal » confirmé présent), `/admin/monitoring` (bouton « Réconcilier » absent — normal, aucune alerte de résultat d'éjection inconnu dans les données de démo ; le composant `ResolveEjectionAction` est conditionnel à une alerte réelle). Build de production (`next build --webpack`) : vérifié, compile.
- Mobile (app cliente Expo, `mobile/`) : build **iOS** vérifié précédemment (simulateur, capture à l'appui). Build **Android** : `npx expo prebuild --platform android` puis `./gradlew :app:assembleDebug` **vérifiés à l'exécution cette session** — APK debug généré avec succès (`mobile/android/app/build/outputs/apk/debug/app-debug.apk`). Lancement sur émulateur **non vérifié** : aucun émulateur Android n'est installé sur cette machine (seul `platform-tools` est présent via Homebrew, pas le paquet `emulator`), et aucun device physique n'était connecté.
- Runtime kiosque Android (`runtime/`) : `./gradlew :app:assembleDebug` **vérifié, `BUILD SUCCESSFUL`**.
- `release:readiness` : sorties conformes à l'état documenté (`PostgreSQL`/`Bajie`/`App Store`/`Google Play` = `BLOCKED`, rien de nouveau).
- PostgreSQL / Bajie / App Store / Google Play : `BLOCKED`, sans changement possible sans action externe — inchangé.

## Contrainte machine découverte cette session — à connaître avant de lancer de gros builds

**Cette machine a très peu de marge disque réelle**, même après nettoyage. Un `df -h /` a montré `228Gi` de taille totale mais seulement une poignée de centaines de Mio à quelques Gio réellement disponibles selon le moment — bien en-deçà de ce que suggère l'espace « Used » affiché (l'écart n'est pas expliqué par l'usage de cette session : Postgres local ~72 Mio, Chromium éphémère ~550 Mio, tous deux supprimés après usage). Le build `mobile/android` a échoué deux fois de suite avec `ENOSPC` en plein milieu de l'empaquetage APK avant de réussir une troisième fois avec ~1.7 Gio de marge.

**Avant tout gros build (`next build`, `gradlew assembleDebug`, installation de dépendances lourdes)** : vérifier `df -h /` d'abord. Si la marge est sous ~1 Gio, nettoyer les artefacts jetables avant de lancer quoi que ce soit — ils se régénèrent sans risque :
- `mobile/android/` (généré par `expo prebuild`, gitignored)
- `mobile/android/app/build` et `mobile/android/android/build` si le dossier natif est gardé
- `~/Library/Caches/ms-playwright` si Playwright a été installé en one-shot pour une vérification visuelle

Si le nettoyage de ces artefacts jetables ne suffit pas à retrouver une marge correcte, c'est le signe d'un problème disque plus large sur cette machine (peut-être des snapshots locaux Time Machine ou un autre volume du même conteneur APFS) — ce n'est pas quelque chose qu'une session de code doit tenter de corriger seule ; le signaler explicitement plutôt que de deviner.

## Le blocage externe qui n'a pas bougé — ne perds pas de temps dessus

Aucun code ne peut faire sortir une batterie de la borne : les credentials marchand ChargeNow sont vides, et surtout **personne n'a confirmé que l'API du fabricant expose une commande d'éjection** (seuls deux endpoints de lecture sont documentés). Détail dans `docs/EXTERNAL_BLOCKERS.md` (relu cette session, toujours exact). Tant que ce point n'a pas bougé côté humain, la route B est bloquée à 100 % quel que soit le code écrit. `core/stripe-coordinator.ts` expose déjà l'interface `AsyncBatteryEjector`, le point d'ancrage prêt pour le jour où un vrai provider existera — ne l'implémente pas avec un endpoint deviné.

## Interdits absolus (inchangés)

- **`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` doit rester `false`.** Le code refuse volontairement de démarrer sinon.
- **Ne lance jamais le serveur de dev directement contre `.env`** : il pointe sur l'instance Supabase de **production**. `.env.local` contient déjà un `DATABASE_URL` local (`postgresql://batyeo:change-me@localhost:5432/batyeo?schema=public`) préparé pour isoler le web de la prod — Next.js le charge en priorité sur `.env`. Toute commande Prisma en ligne de commande (hors Next.js) doit exporter explicitement `DATABASE_URL`/`DIRECT_DATABASE_URL` locaux avant de s'exécuter, car Prisma CLI ne charge pas `.env.local` automatiquement et lirait sinon les identifiants de prod dans `.env`.
- **Ne commit aucun secret.**
- N'ajoute pas de dépendance lourde sans raison.

## Ce qui reste ouvert, sans urgence

- Lancement réel de l'app mobile sur émulateur/device Android : jamais tenté, faute d'émulateur configuré sur cette machine.
- `docs/EXTERNAL_BLOCKERS.md` et `docs/RUNBOOK_STAGING_GO_LIVE.md` relus cette session : toujours exacts, aucune correction nécessaire.
- Le blocage externe (ChargeNow) reste le seul vrai sujet de fond tant qu'il n'a pas bougé côté humain.

## Méthode de travail attendue (inchangée)

- **Vérifie par compilation/exécution réelle, jamais par conviction.**
- **Commit et push au fur et à mesure** sur `main` (`git push origin main`).
- Termine les messages de commit par la ligne d'attribution que tes instructions système te donnent pour cette session (elle varie selon le modèle qui t'exécute — ne la devine pas, utilise celle qui t'est fournie).
- **Respecte le style du repo** : `core/` et `server/` sont volontairement en lignes très denses. Ne reformate pas ce que tu ne touches pas.
- **Commentaires rares**, uniquement le *pourquoi* non évident.
- **Sois honnête sur le non-testé.** Rien n'a jamais tourné sur la borne physique. Écris « vérifié à la compilation » ou « vérifié à l'exécution » selon la vérité, jamais « ça marche » par défaut.
