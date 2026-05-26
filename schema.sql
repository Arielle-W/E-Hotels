-- =============================================================================
-- e-Hôtels — PostgreSQL DDL
-- Derived from application queries in index.js
-- Run: psql -U postgres -c "CREATE DATABASE \"eHotels\";"  (if needed)
--      psql -U postgres -d eHotels -f schema.sql
-- =============================================================================

CREATE TABLE IF NOT EXISTS chainehoteliere (
  id_chaine   SERIAL PRIMARY KEY,
  nom         VARCHAR(200) NOT NULL
);

CREATE TABLE IF NOT EXISTS hotel (
  id_hotel    SERIAL PRIMARY KEY,
  id_chaine   INTEGER NOT NULL REFERENCES chainehoteliere (id_chaine),
  nom         VARCHAR(200) NOT NULL,
  adresse     TEXT,
  categorie   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chambre (
  id_chambre  SERIAL PRIMARY KEY,
  id_hotel    INTEGER NOT NULL REFERENCES hotel (id_hotel) ON DELETE CASCADE,
  prix        NUMERIC(10, 2) NOT NULL,
  vue         VARCHAR(100),
  capacite    INTEGER NOT NULL,
  commodites  TEXT,
  ajouter_lit BOOLEAN DEFAULT FALSE,
  etat        VARCHAR(50) NOT NULL DEFAULT 'disponible',
  superficie  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client (
  id_client     SERIAL PRIMARY KEY,
  nom           VARCHAR(200) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  mot_de_passe  VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS employe (
  id_employe    SERIAL PRIMARY KEY,
  id_hotel      INTEGER NOT NULL REFERENCES hotel (id_hotel) ON DELETE CASCADE,
  nom           VARCHAR(200) NOT NULL,
  adresse       TEXT,
  nas           VARCHAR(20),
  role          VARCHAR(50) NOT NULL,
  email         VARCHAR(255) NOT NULL UNIQUE,
  mot_de_passe  VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS reservation (
  id_reservation   SERIAL PRIMARY KEY,
  id_client        INTEGER NOT NULL REFERENCES client (id_client),
  id_chambre       INTEGER NOT NULL REFERENCES chambre (id_chambre),
  date_debut       DATE NOT NULL,
  date_fin         DATE NOT NULL,
  date_reservation TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location (
  id_location    SERIAL PRIMARY KEY,
  id_client      INTEGER NOT NULL REFERENCES client (id_client),
  id_chambre     INTEGER NOT NULL REFERENCES chambre (id_chambre),
  id_employe     INTEGER NOT NULL REFERENCES employe (id_employe),
  id_reservation INTEGER REFERENCES reservation (id_reservation),
  date_debut     DATE NOT NULL,
  date_fin       DATE NOT NULL,
  date_checkin   TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chambre_hotel ON chambre (id_hotel);
CREATE INDEX IF NOT EXISTS idx_reservation_chambre ON reservation (id_chambre);
CREATE INDEX IF NOT EXISTS idx_reservation_client ON reservation (id_client);
CREATE INDEX IF NOT EXISTS idx_location_chambre ON location (id_chambre);
CREATE INDEX IF NOT EXISTS idx_location_employe ON location (id_employe);
CREATE INDEX IF NOT EXISTS idx_employe_hotel ON employe (id_hotel);
