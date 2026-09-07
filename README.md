# Ecofinity — Order & Project Cockpit

Cockpit voor Ecofinity's bestaande zeven Teamleader-projectfasen (Bij bestelling → ... →
Administratie afgewerkt). Teamleader blijft overal de *source of truth*; deze repo voegt
geen nieuwe of alternatieve fasenstructuur toe.

## Structuur

- **`frontend/ecofinity-cockpit.html`** — de cockpit zelf: dashboard, bestelwachtrij,
  planningswachtrij, kanban, doorlooptijd en fase-instellingen. Eén standalone HTML-bestand,
  gewoon te openen in een browser. Draait standaard in demo-modus (voorbeelddata) en kan via
  de instellingenpagina live gekoppeld worden aan de backend hieronder.
- **`backend/`** — de Node.js/Express-backend die de Teamleader-koppeling verzorgt (OAuth2,
  sync-engine, database, REST-API). Zie `backend/README.md` voor het volledige
  architectuuroverzicht en de opstartinstructies (mock-modus zonder Teamleader-account, of
  live met een echte marketplace-app + Postgres-database).

## Snel starten

```bash
cd backend
npm install
cp .env.example .env      # MOCK_MODE=true staat al standaard aan
node src/server.js
```

Open daarna `frontend/ecofinity-cockpit.html` in de browser, ga naar "Fase-instellingen" en
verbind met `http://localhost:4000`.

## De cockpit openen via GitHub (GitHub Pages)

Deze repo bevat `.github/workflows/publish-pages.yml`, die bij elke push naar `main`
automatisch `frontend/ecofinity-cockpit.html` publiceert als een echte, deelbare webpagina.

**Eénmalig in te stellen** (dit kan ik niet namens jou doen zonder toegang tot je
GitHub-account):
1. Ga in de repo naar **Settings → Pages**.
2. Zet bij **"Build and deployment" → Source** de waarde op **"GitHub Actions"**
   (niet "Deploy from a branch").
3. Push een wijziging naar `main` (of open het tabblad **Actions** en start de workflow
   "Publiceer cockpit op GitHub Pages" handmatig via **"Run workflow"**).

Na een paar minuten verschijnt de link bovenaan onder **Settings → Pages**, in het formaat:
```
https://<jouw-gebruikersnaam>.github.io/<jouw-repo>/
```
Elke volgende push die `frontend/ecofinity-cockpit.html` wijzigt, publiceert automatisch
een bijgewerkte versie op datzelfde adres.
