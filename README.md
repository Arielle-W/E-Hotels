# e-Hôtels — Hotel Management & Analytics Platform

A full-stack hotel reservation and operations system built for **CSI 2532 (Database I)** at the **University of Ottawa**. The application supports clients, front-desk employees, and hotel managers, with a PostgreSQL backend and a REST API consumed by role-based web interfaces.

> This repository highlights **SQL analytics** (occupancy, revenue, customer behavior, operational KPIs) alongside a working web application—relevant.

---

## Academic context

| | |
|---|---|
| **Course** | CSI 2532 — Database fundamentals (relational model, SQL, application–database integration) |
| **Institution** | University of Ottawa, Faculty of Engineering |
| **Project type** | Term project-schema design through queries to web UI |
| **Author** | Wabo Souoguem Claude Arielle -Software Engineering student |


---

## Problem statement

Hotels need to manage inventory (rooms), bookings (reservations), and active stays (check-ins / locations) while tracking performance metrics such as occupancy and revenue. **e-Hôtels** models a multi-property chain and supports three user roles:

| Role | Capabilities |
|------|----------------|
| **Client** | Search available rooms, create and cancel reservations |
| **Employee** | Check in reservations, walk-in locations, client lookup |
| **Manager** | Dashboard KPIs, room CRUD, employee management |

---

## Main database schema

```
chainehoteliere (1) ──< hotel (1) ──< chambre
                              │
                              ├──< employe
                              │
client ──< reservation >── chambre
   │
   └──< location >── chambre
              └── employe (check-in staff)
```

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `chainehoteliere` | Hotel brand / chain | `id_chaine`, `nom` |
| `hotel` | Property | `id_hotel`, `id_chaine`, `nom`, `adresse`, `categorie` |
| `chambre` | Room inventory | `prix`, `vue`, `capacite`, `superficie`, `etat`, `commodites`, `ajouter_lit` |
| `client` | Guest accounts | `nom`, `email`, `mot_de_passe` |
| `employe` | Staff per hotel | `id_hotel`, `role`, `nas`, `email`, `mot_de_passe` |
| `reservation` | Future bookings | `date_debut`, `date_fin`, `date_reservation` |
| `location` | Active / completed stays | `id_reservation` (nullable), `date_checkin` |

**Revenue rule (analytics):** estimated revenue = `room_price × max(1, nights)` on `location` rows (same logic as the manager dashboard API).

**Occupancy rule:** a room counts as occupied on date *D* if an overlapping `location` **or** `reservation` exists for that date.

DDL script: [`schema.sql`](schema.sql)

---

## Analytical SQL queries

Eight business-oriented queries live in [`analytics/queries.sql`](analytics/queries.sql). They use joins, CTEs, window functions (`RANK`, `LAG`, `NTILE`, moving averages), and subqueries.

| # | Business question | SQL techniques |
|---|-------------------|----------------|
| **Q1** | Occupancy rate by hotel (today) | CTE, `UNION`, aggregation |
| **Q2** | 7-day occupancy trend + 3-day moving average | `generate_series`, `LATERAL`, window `AVG` |
| **Q3** | Revenue by room view (`vue`) | `SUM`, `RANK`, `% of total` window |
| **Q4** | Top clients by frequency and spend | `UNION ALL`, `NTILE` |
| **Q5** | Rooms never booked | `NOT EXISTS` anti-join |
| **Q6** | Average / median length of stay by capacity | `PERCENTILE_CONT`, `GROUP BY` |
| **Q7** | Month-over-month revenue growth | `LAG`, monthly buckets |
| **Q8** | Employee productivity & reservation conversion | `FILTER`, `RANK`, funnel metrics |

Run in **pgAdmin**, **DBeaver**, or `psql` against a populated database.

---

## Tech stack

| Layer | Technology |
|-------|------------|
| Database | **PostgreSQL** |
| Backend | **Node.js**, **Express** |
| DB driver | **pg** (connection pool) |
| Frontend | HTML, CSS, vanilla JavaScript (`fetch` REST client) |
| Config | `.env` (optional; connection is currently set in `index.js`) |

**Note:** `index.js` uses the `cors` middleware. If the server fails on startup with `Cannot find module 'cors'`, run:

```bash
npm install cors
```

---

## Project structure

```
ehotels/
├── index.js                 # REST API + manager dashboard analytics
├── schema.sql               # PostgreSQL DDL (7 tables + indexes)
├── analytics/
│   └── queries.sql          # 8 portfolio analytical queries
├── public/                  # Static web UI
│   ├── login.html
│   ├── client-recherche.html
│   ├── client-reservations.html
│   ├── employe-reservations.html
│   ├── employe-location-directe.html
│   ├── manager-dashboard.html
│   ├── admin-chambres.html
│   ├── admin-employes.html
│   └── admin-clients.html
├── package.json
└── README.md
```

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS 18+ recommended)
- [PostgreSQL](https://www.postgresql.org/) 14+
- Git

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/ehotels.git
cd ehotels
npm install
npm install cors
```

### 2. Create the database

```bash
# Example (adjust user/password as needed)
psql -U postgres -c "CREATE DATABASE \"eHotels\";"
psql -U postgres -d eHotels -f schema.sql
```

Seed sample data: at least one chain, hotels, rooms, clients, and employees so login and analytics queries return meaningful results.

### 3. Configure the connection

Update the connection string in `index.js` to match your environment (use placeholders in documentation; do not commit real passwords):

```text
postgresql://postgres:YOUR_PASSWORD@localhost:5432/eHotels
```

Optional `.env` variables (if you wire `dotenv` later):

```text
DB_HOST=localhost
DB_PORT=5432
DB_NAME=eHotels
DB_USER=postgres
DB_PASSWORD=YOUR_PASSWORD
PORT=3000
```

### 4. Run the application

```bash
node index.js
```

Open in a browser:

| Page | URL |
|------|-----|
| Login | http://localhost:3000/login.html |
| Client room search | http://localhost:3000/client-recherche.html |
| Manager dashboard | http://localhost:3000/manager-dashboard.html |
| Room admin | http://localhost:3000/admin-chambres.html |
| Employee admin | http://localhost:3000/admin-employes.html |

Default port: **3000**.

### Demo login credentials

Use these accounts on [login.html](http://localhost:3000/login.html) after seeding the database with the project’s sample data:

| Role | Name | Email | Password |
|------|------|-------|----------|
| Manager (gestionnaire) | Marc Lefebvre | directeur.lefebvre@hotel1.com | `hash_pass_ges_1` |
| Employee (employé) | Alicia Tremblay | a.tremblay@hotel1.com | `pass_cdr_1` |
| Client | Jean-Luc Picard | jl.picard@starfleet.fr | `enterprise1701` |

> **Note:** Passwords are stored in plain text for this academic demo only. Do not use this pattern in production.

### 5. Run analytical queries

```bash
psql -U postgres -d eHotels -f analytics/queries.sql
```

For **Q2**, edit the `params` CTE in `analytics/queries.sql` and set `id_hotel` to an existing hotel id before running.

---

## API highlights

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/login` | Client or employee authentication |
| `GET` | `/chambres/disponibles` | Room search with availability filters |
| `GET` | `/chambres/disponibles-hotel/:id_hotel` | Rooms free for one hotel and date range |
| `POST` | `/reservations` | Create booking |
| `GET` | `/reservations/:id_client` | Client reservation history |
| `DELETE` | `/reservations/:id` | Cancel reservation (if not checked in) |
| `PUT` | `/reservations/:id/checkin` | Convert reservation to stay |
| `POST` | `/locations` | Walk-in location (no prior reservation) |
| `GET` | `/employes/:id_hotel` | List employees for a hotel |
| `POST` | `/employes` | Create employee |
| `GET` | `/manager/hotel/:id_hotel/dashboard` | Manager KPIs (occupancy, revenue, trends) |
| `GET` | `/clients` | Client search (optional `?q=`) |

---

## Skills demonstrated

- Relational schema design and referential integrity  
- Complex SQL for operational and strategic reporting  
- REST API design and integration with a web front end  
- Role-based workflows (client / employee / manager)  
- Translating business rules (occupancy, revenue) into queries and application logic  

---

## Future improvements

- Hash passwords and load secrets from environment variables  
- Expose read-only analytics endpoints or materialized views  
- Export dashboard metrics to CSV for BI tools (Power BI, Tableau)  
- Add automated tests for critical API routes  

---

## License

Academic project — University of Ottawa. Contact the author before commercial use.

---


