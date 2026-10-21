# sonnenBatterie

Intégration **non officielle**, sans lien avec sonnen. Elle lit votre
**sonnenBatterie** (eco, 10, hybrid…) sur votre réseau local, par son API
locale v2 (HTTP), avec un jeton de lecture, sans cloud.

**Jamais testé avec un vrai appareil** : l'intégration a été écrite d'après la
bibliothèque [sonnen-api-v2](https://github.com/Katamave/sonnen_api_v2) et la
documentation de l'API que la batterie sert à `/api/doc.html`, sans
sonnenBatterie sous la main. Vos retours sont les bienvenus.

## Lecture seule

L'intégration **ne fait que lire** (requêtes GET de l'API de lecture). Elle ne
change jamais le mode de fonctionnement, ne force jamais de charge ni de
décharge et ne modifie aucun réglage. Un jeton de **lecture** suffit.

## Ce que vous obtenez

Un appareil « sonnenBatterie » (une batterie par intégration : celle dont le
jeton est saisi ; l'API de lecture ne donne pas de numéro de série) :

- niveau de charge utilisable (USOC, %, celui de l'application sonnen), niveau
  de charge relatif (RSOC), énergie utilisable restante (kWh) ;
- puissances de charge et de décharge (W), puissance de la batterie (W,
  positive en décharge), état (0 = au repos, 1 = en charge, 2 = en décharge) ;
- puissance solaire (W) et **l'index de production solaire** du compteur de
  production de la batterie, pour le suivi énergétique de Gladys (avec sa
  production par demi-heure, calculée par Gladys) ;
- consommation de la maison (W, moyenne, et compteur en kWh) ;
- échange avec le réseau (W, positif quand la maison prend au réseau, négatif
  quand elle injecte), état du réseau (0 = sur le réseau, 1 = hors réseau, en
  secours), tension et fréquence ;
- réserve de secours (%), mode de fonctionnement (1 = manuel,
  2 = autoconsommation, 6 = extension de modules, 10 = tarif horaire « Time of
  Use »),
  décharge interdite (0/1) ;
- cycles, températures mini et maxi des cellules, tension DC, capacité de
  pleine charge et capacité installée.

### Pas de double comptage

Le compteur de consommation de la batterie mesure la consommation de la
maison, que le compteur principal (Linky…) compte déjà dans Gladys. Il est donc
publié comme **simple capteur**, jamais comme index de consommation : rien
n'est facturé deux fois. L'intégration n'envoie aucune consommation
journalière. Seul l'index de **production solaire** alimente le suivi
énergétique.

**Production solaire et onduleur** : une sonnenBatterie eco est couplée en AC,
avec un onduleur solaire séparé (SMA, Fronius, SolarEdge, Kostal…), et son
compteur de production mesure cet onduleur. Si votre onduleur envoie déjà sa
production à Gladys, **ne gardez qu'une source** : choisissez **Capteur
seulement** dans « Production solaire » **avant** de créer l'appareil. La
production est alors un simple capteur (kWh, jamais compté) et l'index ne
reçoit rien. Changer ce choix après la création : un appareil créé garde
toutes ses fonctionnalités (aucune n'est retirée), seule la fonctionnalité du
choix en cours reçoit des valeurs ; pour un appareil propre, supprimez-le et
recréez-le.

## Prérequis

- Gladys 5.2.0 ou plus récent.
- La batterie sur le même réseau que Gladys, son API joignable en HTTP (port
  80).
- Un jeton de lecture : dans l'interface web locale de la batterie
  (`http://<adresse-de-la-batterie>`), menu **Software-Integration**, **JSON
  API**, activez **Read API** et copiez le jeton.

## Configuration

1. Installez l'intégration depuis le store de Gladys.
2. **Adresse IP de la batterie** : son adresse sur votre réseau (avec `:port`
   seulement si ce n'est pas 80). Donnez-lui de préférence une adresse fixe
   dans votre box.
3. **Jeton de lecture** : gardé par Gladys dans sa base, jamais réaffiché,
   envoyé seulement à la batterie (dans l'en-tête de ses requêtes), jamais
   journalisé.
4. **Intervalle de lecture** : 30 s par défaut, de 30 à 300 s (cinq petites
   requêtes à chaque lecture).
5. Après la première lecture, créez l'appareil depuis l'onglet **Découverte**.

Le bouton **Tester la connexion** lit la batterie une fois si l'intervalle est
écoulé ; sinon il affiche la dernière lecture et l'heure de la prochaine
possible.

## Rythme des lectures

Rien ne lit la batterie plus vite que l'intervalle : ni le bouton de test, ni
l'onglet Découverte, ni une reconnexion à Gladys, ni l'enregistrement d'une
configuration inchangée, ni un redémarrage du conteneur (l'heure de la
dernière lecture est gardée dans `/data`, écrite au plus une fois par minute :
après un redémarrage, la première lecture attend l'intervalle plus une minute).
Une nouvelle adresse ou un nouveau jeton sont essayés tout de suite.

## Index retenu

Gladys compte chaque hausse d'un index en entier. Pour ne jamais compter une
énergie fictive, l'index de production solaire passe par une garde :

- une valeur à 0 n'est jamais envoyée ;
- une baisse, ou une hausse plus rapide que 30 kW en moyenne, est
  **retenue** : la dernière valeur acceptée est renvoyée, et l'état de
  l'intégration l'affiche. Ni le temps ni la répétition ne la confirment ;
- si elle est juste, cliquez **deux fois** sur **Accepter l'index retenu** : le
  premier clic liste ce qui est retenu sans rien accepter, le second, de
  3 secondes à 5 minutes plus tard, accepte exactement ce qui a été listé (un
  saut est alors compté d'un coup, une baisse ne compte rien). Enregistrer la
  configuration n'accepte rien.

## Erreurs

- **Jeton refusé** (HTTP 401/403) : les lectures s'arrêtent, l'état le dit.
  Sans changement, un nouvel essai a lieu après 15 minutes, puis 30, jusqu'à
  6 heures ; cet arrêt est gardé dans `/data` après un redémarrage. Un nouveau
  jeton enregistré est essayé tout de suite. Pour reconnaître un jeton refusé
  après un redémarrage, `/data` garde une empreinte salée de ce jeton refusé
  seulement (jamais du bon), effacée à la première lecture réussie.
- Une réponse HTTP 429 ou 5xx de la configuration met la batterie en pause de
  1 minute à 6 heures, gardée dans `/data`. Une erreur d'un autre point de
  l'API laisse seulement ses valeurs de côté : les autres sont publiées.
- Une batterie injoignable est réessayée après 1 minute, puis 2, jusqu'à
  15 minutes, jamais plus vite que l'intervalle.
- Seul un refus de la **configuration** vaut jeton refusé. Si une autre partie
  de l'API (compteurs, modules…) refuse le jeton alors que la configuration
  l'accepte, seules ses valeurs manquent, l'état le dit, les lectures
  continuent.
- Chaque lecture commence par la configuration, avec le jeton : une autre
  batterie qui prendrait l'adresse (DHCP) refuse ce jeton et ne donne rien.
  Une fois par démarrage, l'intégration demande aussi la configuration sans
  jeton : si la batterie répond quand même, l'état conseille de lui donner une
  adresse fixe (seule l'adresse l'identifie alors).

## Confidentialité

Rien ne sort de votre réseau : l'intégration ne parle qu'à la batterie, en
HTTP local, et ne suit aucune redirection. Le jeton circule en clair sur votre
réseau local, comme pour l'application de la batterie.
