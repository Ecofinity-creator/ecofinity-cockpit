# Ecofinity — Teamleader-koppeling voor de Order & Project Cockpit

Dit is de backend die de bestaande zeven Teamleader-projectfasen (Bij bestelling → ... →
Administratie afgewerkt) rechtstreeks uit Teamleader haalt en via een eigen REST-API aanbiedt
aan de cockpit (`ecofinity-cockpit.html`). Teamleader blijft overal de *source of truth*;
deze backend voegt geen nieuwe of alternatieve fasenstructuur toe (zie sectie 1 & 17 van de
oorspronkelijke functionele spec).

## Architectuur in één oogopslag

```
Teamleader (deals, projecten, milestones/projectGroups)
        │  OAuth2 + webhooks + periodieke poll
        ▼
  Sync-engine (src/sync/syncEngine.js)
        │  past deriveCurrentProjectPhase() toe (src/phases/phaseModel.js)
        ▼
  Postgres  (deals · projects · project_phase_history · settings)
        │
        ▼
  REST-API  (src/api/cockpitRoutes.js)  ──►  Order & Project Cockpit (frontend)
```

Twee databronnen implementeren exact hetzelfde contract, zodat de rest van het systeem niet
hoeft te weten welke actief is:

- **`MockDataProvider`** — ingebakken voorbeelddata (dezelfde 15 dossiers als in het
  frontend-concept). Handig om nu al te bouwen/testen, vóór de Teamleader-marketplace-app
  goedgekeurd is.
- **`LiveDataProvider`** — leest uit Postgres, gevuld door de sync-engine.

Schakelen gebeurt met één env-variabele: `MOCK_MODE=true|false`.

## Snel starten (mock-modus, geen Teamleader-account nodig)

```bash
npm install
cp .env.example .env        # MOCK_MODE=true staat al standaard aan
node src/server.js
curl http://localhost:4000/api/cockpit-data
```

Dit is al getest en werkt: alle 7 fasen, fase-afleiding (incl. de automatische
inconsistentie-detectie), deadline-status, en de instellingen-endpoints draaien.

## Live koppelen met Teamleader

1. **Registreer een integratie** op https://marketplace.focus.teamleader.eu/build
   (kan privaat blijven). Vul de whitelisted redirect-URI in
   (`<PUBLIC_BASE_URL>/oauth/callback`) en kies de scopes voor deals, projecten,
   milestones/projectGroups, timetracking, webhooks.
2. Vul `.env` aan met `TEAMLEADER_CLIENT_ID`, `TEAMLEADER_CLIENT_SECRET`,
   `PUBLIC_BASE_URL`, een willekeurige `WEBHOOK_SECRET_PATH`, en `DATABASE_URL`.
3. Zet `MOCK_MODE=false`.
4. Maak de database aan en voer het schema uit: `psql $DATABASE_URL -f src/db/schema.sql`.
5. Start de server: `node src/server.js`.
6. Rond de koppeling af door in de browser naar `<PUBLIC_BASE_URL>/oauth/authorize` te gaan.
7. Registreer de webhooks: `curl -X POST <PUBLIC_BASE_URL>/admin/register-webhooks`.
8. Trigger een eerste volledige sync: `curl -X POST "<PUBLIC_BASE_URL>/admin/sync-now?full=true"`.

Daarna houdt de combinatie van webhooks (real-time) + de periodieke poll
(`POLL_INTERVAL_MINUTES`, veiligheidsnet) de database automatisch synchroon.

## Openstaande punten om te bevestigen bij het echte Teamleader-account

De publieke Teamleader-documentatie (developer.focus.teamleader.eu) bevestigt de
RPC-endpoints, OAuth2-flow, paginering, rate-limiting en het bestaan van
`accounts.projects-v2-status`, `milestones`/`projects-v2/projectGroups`, `webhooks.register`,
enz. Een paar dingen zijn accountspecifiek en dus best te verifiëren zodra jullie
marketplace-app actief is (in de code gemarkeerd met `LET OP` / `te bevestigen`):

1. **Deal → project-koppeling** (`src/sync/syncEngine.js#_resolveLinkedProjectId`) —
   sommige Teamleader-accounts leggen dit vast via een custom field op de deal, andere via
   een directe API-relatie. Moet éénmalig bevestigd worden tegen jullie eigen account.
2. **Exacte veldnamen** voor opleverdatum/geschatte/geregistreerde tijd op milestones
   resp. projectGroups (`src/teamleader/projectsApi.js`) — de aanwezigheid van deze data is
   bevestigd in de Teamleader-changelog, de exacte JSON-sleutels zijn best-effort en te
   verifiëren met één test-call.
3. **Exacte webhook-type-namen** (`src/teamleader/webhooksApi.js`) — we registreren een
   ruime kandidatenlijst; niet-ondersteunde types falen individueel zonder de rest te
   blokkeren, en de periodieke poll vangt sowieso alles op.
4. **Legacy vs. Projects-v2** — wordt automatisch gedetecteerd via
   `accounts.projects-v2-status`; beide paden zijn geïmplementeerd.

Geen van deze punten verandert iets aan de kernarchitectuur of aan de 7 vaste fasen — het
zijn precisie-details in hoe we bij dezelfde data komen.

## REST-contract (wat de frontend nodig heeft)

- `GET /api/cockpit-data` — alles in één call: fasen, verrijkte projectenlijst
  (incl. `daysInPhase`, `deadlineStatus`, `hasIssue`, `phaseLabel`), doorlooptijd-KPI's,
  instellingen.
- `GET /api/projects/:dealId` — zelfde verrijking voor één dossier (projectdetailpagina).
- `GET/POST /api/settings/phase-mapping` — fase-aliassen (sectie 5: nieuwe/hernoemde
  Teamleader-fasen koppelen zonder de 7 basisfasen te wijzigen).
- `GET/PUT /api/settings/deadline-threshold` — de configureerbare grenswaarde uit sectie 9.

## Volgende stap voor de frontend

`ecofinity-cockpit.html` is al aangesloten: open de "Fase-instellingen"-pagina in de cockpit,
vul onder "Teamleader-koppeling" het adres van deze backend in (bv. `http://localhost:4000`
tijdens lokale ontwikkeling) en klik "Verbinden". Bij succes vervangt de cockpit de
demo-mockdata onmiddellijk door de live Teamleader-data — dashboard, wachtrijen, kanban,
doorlooptijd en projectdetail draaien dan allemaal op echte cijfers. Er gebeurt bewust
niets automatisch bij het opstarten van de cockpit: de backend-locatie verschilt per
omgeving (lokaal, staging, productie), dus de gebruiker verbindt zelf.

Let op: de cockpit-HTML draait doorgaans in de browser van de gebruiker (of in een
preview-sandbox), niet op hetzelfde toestel als deze backend. Zorg dat de backend
publiek/binnen het netwerk bereikbaar is vanaf waar de cockpit geopend wordt (lokaal:
`localhost` werkt enkel als beide op dezelfde machine draaien; anders een gedeeld
netwerkadres, een tunnel zoals ngrok voor test, of een echte hosting-omgeving).
