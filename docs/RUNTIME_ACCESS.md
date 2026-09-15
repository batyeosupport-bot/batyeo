# Runtime station access

La politique `authorizeRuntime` limite un principal runtime authentifié à sa
station et aux opérations `config/read`, `heartbeat/write`, `station/read`,
`provider/status` et `diagnostics/read`. Ces noms sont un contrat de domaine :
ils ne constituent pas des routes HTTP déjà déployées.

`RuntimeEnrollmentRegistry` reste un registre local/demo en mémoire. Les tokens
d'enrôlement expirent après dix minutes au maximum et sont à usage unique, même
avec des appels concurrents. Les credentials sont rotatables et révocables ; ils
n'ont actuellement pas de date d'expiration automatique. Une révocation en cours
d'authentification ou de rotation est prise en compte avant le résultat.

Les helpers de persistance refusent le changement de station/partenaire, une
ancienne version de credential et la restauration d'un credential révoqué par
upsert. Les endpoints d'administration devront vérifier l'identité de l'acteur
et ses droits dans la transaction avant d'appeler ces helpers : ils ne réalisent
pas eux-mêmes l'authentification Admin.

Les routes POST `/api/core/runtime/enrollment-token` et
`/api/core/runtime/revoke` exigent une session opérateur autorisée, revérifiée
dans la transaction. `/api/core/runtime/enroll` consomme le token une seule fois
et crée le credential dans la même transaction. Une station ne peut avoir deux
runtimes actifs via cette route. Le rejeu échoue ; en cas de réponse perdue,
l'opérateur doit révoquer l'enregistrement avant un nouvel enrôlement avec un
nouvel identifiant runtime. Aucun secret brut ne doit être persisté ou journalisé.

La création et la consommation utilisent le repository existant (D1 preview ou
Prisma). `GET /api/core/runtime/station` exige `Authorization: Bearer …` et
`X-Batyeo-Runtime-Id`. Chaque requête relit le credential persisté, sa révocation
et sa station. La réponse est la projection écran du Core, sans données client
ni secret fournisseur. Un cookie Admin seul ne donne pas accès à cette route.

`POST /api/core/runtime/rotate` exige une session opérateur et le corps
`{runtimeId, expectedVersion}`. La comparaison de version et la rotation sont
atomiques. Le nouveau secret n'est renvoyé qu'une fois. Une réponse perdue
nécessite une nouvelle intervention opérateur ; ne pas réutiliser l'ancien secret.

Les routes de configuration distante et heartbeat restent à brancher. Ce lot ne certifie pas un enrôlement sur une
borne réelle ni sur PostgreSQL réseau.
