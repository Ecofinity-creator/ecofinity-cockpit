-- Ecofinity Order & Project Cockpit — databaseschema
-- Bewaart een genormaliseerde kopie van Teamleader-data zodat het dashboard/de wachtrijen
-- snel te bevragen zijn zonder bij elke pageview de Teamleader-API te raadplegen.
-- Teamleader blijft de source of truth; deze tabellen zijn een ververste cache + historiek.

CREATE TABLE IF NOT EXISTS deals (
  deal_id            TEXT PRIMARY KEY,
  customer           TEXT NOT NULL,
  title              TEXT,
  deal_closed_at     DATE NOT NULL,        -- besteldatum, UITSLUITEND van de deal
  priority_rank      INTEGER,              -- herberekend na elke sync, op basis van deal_closed_at
  has_linked_project BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  project_id          TEXT PRIMARY KEY,
  deal_id             TEXT NOT NULL REFERENCES deals(deal_id) ON DELETE CASCADE,
  project_title       TEXT,
  current_phase_code  TEXT,                -- '01'..'07', of NULL (onbekende fase / geen koppeling)
  closed              BOOLEAN NOT NULL DEFAULT FALSE,
  data_issue          TEXT,                -- ingevuld door deriveCurrentProjectPhase() bij inconsistentie
  unknown_phase_label TEXT,                -- ingevuld als Teamleader een niet-gemapte fase gebruikt
  hold_reason         TEXT,                -- handmatige blokkering (sectie 13), los van de fase zelf
  hold_note           TEXT,
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_deal ON projects(deal_id);

-- Eén rij per fase per project: historiek + opleverdata + geregistreerde/geschatte tijd
-- (dit voedt zowel de "Werkoverzicht"-tabel als de doorlooptijd-KPI's in sectie 14).
CREATE TABLE IF NOT EXISTS project_phase_history (
  id                SERIAL PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
  phase_code        TEXT NOT NULL,          -- '01'..'07'
  done              BOOLEAN NOT NULL DEFAULT FALSE,
  entered_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  planned_ends_on   DATE,                   -- "opleverdatum" uit Teamleader
  time_estimated_seconds INTEGER,
  time_registered_seconds INTEGER,
  UNIQUE (project_id, phase_code)
);

-- Uitvoeringsafspraak (fase 05) — datum/tijd/team, rechtstreeks uit de Teamleader-planning/agenda.
CREATE TABLE IF NOT EXISTS project_installations (
  project_id   TEXT PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
  install_date DATE,
  start_time   TIME,
  end_time     TIME,
  team_label   TEXT
);

-- Fase-aliassen (sectie 5-configuratiepagina): koppelt afwijkende Teamleader-fasenamen
-- aan één van de 7 vaste interne fasecodes, zonder ooit de 7 fasen zelf te wijzigen.
CREATE TABLE IF NOT EXISTS phase_aliases (
  alias TEXT PRIMARY KEY,
  code  TEXT NOT NULL CHECK (code IN ('01','02','03','04','05','06','07'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
-- verwachte keys: 'attention_threshold_days', 'oauth_tokens', 'last_sync_at'

CREATE TABLE IF NOT EXISTS sync_issues (
  id         SERIAL PRIMARY KEY,
  deal_id    TEXT,
  message    TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
