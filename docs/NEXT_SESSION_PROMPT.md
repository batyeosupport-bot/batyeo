# Brief de reprise — session autonome

> À coller tel quel au démarrage d'une nouvelle session Claude Code.
> Rédigé le 2026-09-17 à la fin d'une session qui a livré les commits `b8c057a` → `f77382f`.

---

Tu reprends le projet BATYEO seul. Je pars, donc **ne me pose aucune question** : prends les décisions raisonnables toi-même, documente-les dans tes commits, et laisse un récapitulatif honnête à la fin. Avance au maximum.

## Le projet

BATYEO loue des batteries externes dans des bornes physiques installées chez des commerçants (bars, hôtels). Le client scanne un QR ou paie par carte sur la borne, prend une batterie, la rend sous 48 h.

Le repo est à `/Users/anismeslin/Developer/BATYEO` (monorepo) :
- **`core/`** — domaine métier : machine à états de location, tarification, config runtime versionnée, i18n, médias, heartbeat. C'est le cœur, très testé.
- **`server/http.ts`** — toutes les routes API.
- **`app/` + `components/batyeo/`** — site public Next.js, portail admin/partenaire, page kiosque `/kiosk/[publicId]`.
- **`mobile/`** — app client Expo/React Native (npm, pas pnpm).
- **`runtime/`** — app kiosque Android native en Kotlin qui tourne **sur la borne**.

## Le matériel (déjà identifié, ne refais pas l'enquête)

La borne physique est une **Bajie / ChargeNow** :
- Package de leur appli d'origine : `com.szbjkj.bajietouchpower`
- Serveur fabricant : `dtas.chargenow.top:10382`
- Device ID de la borne : **`DTA55480`**
- Lecteur carte : **Stripe Terminal / BBPOS WisePOS** (confirmé par leurs logs : `PosType:stripe`)
- Pas de carte SIM active (`ICCID: NULL`) — la borne n'a pas encore de réseau
- Les fichiers extraits de la borne sont dans `~/Downloads/Apk Doc /` si besoin

## La décision stratégique : route B

Trois routes avaient été identifiées pour faire sortir une batterie :

- **A** — garder l'appli du fabricant sur la borne. Marche déjà, mais le client, l'argent et les données sont chez eux.
- **B — ✅ RETENUE** — notre backend pilote leur matériel via leur API cloud. On garde notre API, nos règles, notre Stripe, notre base. On délègue uniquement l'ouverture du verrou.
- **C** — notre propre appli qui parle en série à la carte des slots. Bloqué : protocole binaire propriétaire inconnu.

**Route B veut dire : on ne touche pas au protocole série.** Ne perds pas de temps à le rétro-concevoir.

## Blocages externes — n'essaie pas de les contourner

Ces points attendent une action humaine, pas du code :
1. **Credentials marchand ChargeNow** (`MANUFACTURER_USERNAME` / `PASSWORD` sont vides)
2. **Non confirmé : leur Open API expose-t-elle une commande d'éjection ?** Seuls `/rent/cabinet/query` et `/rent/cabinet/list` sont documentés, tous deux en lecture. **N'invente pas le chemin d'un endpoint d'éjection.** Si tu écris la couche d'éjection, isole le chemin dans **une seule constante nommée** avec un commentaire clair disant qu'il doit être confirmé par le fabricant.
3. **Compte Stripe live** — `PAYMENT_PROVIDER="mock"` aujourd'hui
4. **Pages légales** — `/terms` et `/privacy` disent explicitement « démonstration ». Bloquant pour encaisser réellement, mais c'est un sujet juriste.

## Interdits absolus

- **`MANUFACTURER_ALLOW_PHYSICAL_ACTIONS` doit rester `false`.** Le code refuse volontairement de démarrer sinon (`resolveManufacturerConfig`). Ne le lève pas, même pour tester.
- **Ne lance pas le serveur de dev contre la vraie base.** `.env` pointe sur une instance Supabase de production. Si tu as besoin de faire tourner l'app, isole-toi.
- **Ne commit aucun secret.** `.env` est déjà dans `.gitignore`, garde-le ainsi.
- N'ajoute pas de dépendance lourde sans raison ; le projet est volontairement sobre.

## Ce que j'attends de toi, par ordre de priorité

### 1. Audit complet de l'écosystème
C'est la demande explicite du propriétaire : « vérifier l'app, vérifier tout l'écosystème, que tout soit parfait ».
Établis une base saine : typecheck, lint, tests, build web, build Android, build iOS mobile. Corrige ce qui casse. Rapporte ce qui ne peut pas être vérifié sans matériel.

### 2. Tester le code récent — c'est le trou le plus net
La session précédente a livré beaucoup de code **sans un seul test** :
- `core/i18n.ts` (validation des packs de langues, repli sur langue par défaut, clés manquantes)
- `displayConfigFor()` dans `core/queries.ts` (playlist filtrée, monotonie de la version)
- Routes `runtime/config` et `runtime/heartbeat` dans `server/http.ts`
- La boucle d'appairage (`runtime/enrollment-token` → `runtime/enroll`)

Le projet a 127 tests et une vraie culture de test. Comble ce trou en suivant le style existant dans `tests/`.

### 3. Compléter la machinerie d'éjection de la route B
Le vrai morceau difficile n'est pas l'appel API, c'est : **la commande part, le délai expire, et on ignore si la batterie est sortie.** Un client a été débité — a-t-il reçu quelque chose ?

Audite ce qui existe (`RUNBOOK_UNKNOWN_PHYSICAL_RESULT.md`, les états `EJECTING`/`EJECTION_FAILED`, `reconciliationRecords`) et complète ce qui manque. Cette partie se teste entièrement sans credentials, avec des doubles de test.

### 4. Écran admin pour les Location Stripe
L'app Android attend un ID de Location Stripe saisi à la main. Un écran admin qui liste et assigne serait cohérent avec le reste du portail (`Admin → Affichage`).

### 5. App mobile
Statut `PARTIALLY_READY`. Audite, corrige, rends-la cohérente avec le reste.

## Comment vérifier (commandes exactes, gagne du temps)

```bash
cd /Users/anismeslin/Developer/BATYEO

# Backend
npx tsc --noEmit -p tsconfig.json
npx eslint <fichiers modifiés>
node scripts/test.mjs            # 127 tests, doivent tous passer
npx next build --webpack         # vérifie le rendu React
node --import tsx scripts/release-readiness.ts

# App Android (la chaîne est déjà installée)
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$PATH"
cd runtime && ./gradlew :app:assembleDebug

# Vérifier qu'une classe est VRAIMENT dans l'APK (pas seulement compilée)
apkanalyzer dex packages --defined-only app/build/outputs/apk/debug/app-debug.apk | grep batyeo

# App mobile (npm ici, pas pnpm)
cd mobile && npx tsc --noEmit && npx expo run:ios --device "iPhone 17"
```

⚠️ `npx next build` modifie `tsconfig.json` tout seul (il ajoute `.next/types`). Fais `git checkout tsconfig.json` après.

## Méthode de travail attendue

- **Vérifie par compilation, pas par conviction.** Toute la chaîne est installée : sers-t'en. Ne dis jamais qu'un truc marche si tu ne l'as pas compilé ou testé.
- **Commit et push au fur et à mesure** sur `main` (`git push origin main`). Le propriétaire a déjà perdu une session dans un crash — des commits fréquents sont sa protection.
- Termine les messages de commit par :
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **Respecte le style du repo** : `core/` et `server/` sont volontairement en lignes très denses. Ne reformate pas, ne « nettoie » pas ce que tu ne touches pas.
- **Commentaires rares**, uniquement le *pourquoi* non évident.
- **Sois honnête sur le non-testé.** Rien n'a jamais tourné sur la borne physique. Écris « vérifié à la compilation » quand c'est le cas, jamais « ça marche ».

## À la fin

Laisse un récapitulatif court : ce qui est fait et vérifié, les décisions que tu as prises seul, ce qui reste bloqué et pourquoi.
