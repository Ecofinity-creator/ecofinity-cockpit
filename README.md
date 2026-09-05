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
