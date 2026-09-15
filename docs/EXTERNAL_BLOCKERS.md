# Intégration Bajie / ChargeNow — points externes à confirmer

État : adapter **READ-ONLY** implémenté sur la documentation publique consultée le 12 septembre 2026.

Sources officielles :

- https://s.apifox.cn/4855b8fe-4c43-48f6-8bd6-37cc29b98fe5
- https://developer.chargenow.top/cdb-open-api/v1

## Contrats utilisés

- `GET /rent/cabinet/query?deviceId=...` : détail cabinet, boutique, batteries et slots.
- `POST /rent/cabinet/list?coordType=...&zoomLevel=...&lat=...&lng=...&showPrice=...` : liste géographique documentée.
- Les pages de ces deux routes documentent une authentification HTTP Basic.

## Ambiguïtés documentaires

- La page OAuth2 documente `POST /oauth2/login`, mot de passe préalablement haché en SHA-256, puis un header `Authorization: Bearer ...` pour l’Open API. Les pages cabinet et leurs exemples utilisent cependant HTTP Basic. L’adapter suit les exemples propres aux routes cabinet ; le fabricant doit confirmer le mode d’authentification production.
- La réponse OAuth2 publiée ne décrit pas précisément le champ contenant le token. Aucun parser OAuth2 n’est donc inventé.
- La liste cabinet ne publie pas d’identifiant cabinet dans son exemple ; elle est exposée comme liste de lieux/résumés, pas comme source d’association automatique avec une station BATYEO.
- Aucun champ `lastSeen` n’est publié dans le détail cabinet. BATYEO retourne donc `lastSeenAt: null` et conserve séparément la date de synchronisation locale.
- `vol` est conservé comme tension fournisseur (`voltage`) et n’est pas converti en pourcentage de charge sans règle officielle.
- `busySlots`, `emptySlots`, `freeNum` et `infoStatus` sont conservés sans interprétation métier supplémentaire au-delà de leur nom documenté.
- Aucun mécanisme officiel de signature, identifiant d’événement ou contrat webhook fabricant n’a été confirmé. Le récepteur BATYEO conserve donc ces événements comme non fiables, les déduplique par empreinte interne du payload et ne les utilise jamais directement pour modifier l’état métier. Une lecture API documentée est déclenchée pour réconciliation lorsque le provider est configuré.

## Synchronisation BATYEO

- Les associations sont stockées par couple `manufacturer + externalId` avec unicité en base, afin de pouvoir accueillir plusieurs fabricants sans confondre leurs identifiants.
- Le dernier snapshot est normalisé et interne. Le JSON fournisseur brut n’est pas exposé aux clients.
- Une synchronisation met à jour uniquement la télémétrie provider et les divergences. Elle ne remplace pas automatiquement l’état métier, les slots ou les batteries BATYEO.
- Les retries bornés concernent uniquement les lectures ayant échoué par timeout ou indisponibilité temporaire. Aucune commande physique n’est implémentée.
- `pnpm manufacturer:check` est prêt pour un environnement staging : il exécute uniquement `cabinet/query` puis `cabinet/list`, affiche des métriques anonymisées et peut capturer des fixtures dépersonnalisées avec `MANUFACTURER_CAPTURE_FIXTURE=true` et `MANUFACTURER_FIXTURE_PATH=/chemin/fixtures`.
- Le scheduler appelle `POST /api/core/internal/manufacturer/sync` avec `Authorization: Bearer $MANUFACTURER_SYNC_SECRET`. Le verrou est enregistré dans `ManufacturerSyncRun` et expire après dix minutes pour permettre la récupération d’un worker interrompu.

## Cas BJH02347

La réponse historiquement observée `code: 2002`, message `QR code unbound device.` est conservée comme erreur fournisseur typée avec son code et son message. BATYEO ne lui attribue aucune signification opérationnelle définitive sans confirmation documentaire.

## Vérification externe restante

- Credentials OpenAccount/Bajie valides.
- Confirmation Basic versus OAuth2/Bearer pour les routes cabinet.
- Fixtures réelles anonymisées pour valider les champs optionnels et unités.
- Autorisation explicite séparée avant toute future commande physique. `MANUFACTURER_ALLOW_PHYSICAL_ACTIONS=false` reste obligatoire dans cette phase.
