-- =============================================================================
-- e-Hôtels — Analytical SQL queries (PostgreSQL)
-- CSI 2532 | Portfolio — junior data analytics
--
-- Conventions (match index.js / node-pg):
--   - Unquoted identifiers fold to lowercase in PostgreSQL.
--   - Occupancy on date D: overlapping location OR reservation.
--   - Revenue: room price × GREATEST(1, nights) on location rows.
--
-- Run: psql -U postgres -d eHotels -f analytics/queries.sql
-- Or execute each query block separately in pgAdmin / DBeaver.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Q1 — Business question:
-- What is today's occupancy rate for each hotel?
-- Techniques: CTE, UNION, LEFT JOIN, aggregation
-- -----------------------------------------------------------------------------
WITH occupied_today AS (
  SELECT DISTINCT ch.id_hotel, ch.id_chambre
  FROM chambre ch
  INNER JOIN location l ON l.id_chambre = ch.id_chambre
  WHERE l.date_debut::date <= CURRENT_DATE
    AND l.date_fin::date > CURRENT_DATE
  UNION
  SELECT DISTINCT ch.id_hotel, ch.id_chambre
  FROM chambre ch
  INNER JOIN reservation r ON r.id_chambre = ch.id_chambre
  WHERE r.date_debut::date <= CURRENT_DATE
    AND r.date_fin::date > CURRENT_DATE
)
SELECT
  h.id_hotel,
  h.nom AS hotel_name,
  COUNT(DISTINCT c.id_chambre) AS total_rooms,
  COUNT(DISTINCT o.id_chambre) AS occupied_rooms,
  ROUND(
    100.0 * COUNT(DISTINCT o.id_chambre)
    / NULLIF(COUNT(DISTINCT c.id_chambre), 0),
    1
  ) AS occupancy_rate_pct
FROM hotel h
INNER JOIN chambre c ON c.id_hotel = h.id_hotel
LEFT JOIN occupied_today o
  ON o.id_hotel = h.id_hotel AND o.id_chambre = c.id_chambre
GROUP BY h.id_hotel, h.nom
ORDER BY occupancy_rate_pct DESC;


-- -----------------------------------------------------------------------------
-- Q2 — Business question:
-- How did occupancy evolve over the last 7 days for one hotel (3-day moving avg)?
-- Techniques: generate_series, CTE, LATERAL subquery, window AVG
-- Parameter: change id_hotel in params CTE (default 1)
-- -----------------------------------------------------------------------------
WITH params AS (
  SELECT 1::int AS id_hotel  -- <<< set your hotel id here
),
days AS (
  SELECT generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day')::date AS day
),
room_inventory AS (
  SELECT COUNT(*)::numeric AS total_rooms
  FROM chambre c
  CROSS JOIN params p
  WHERE c.id_hotel = p.id_hotel
),
daily_occupied AS (
  SELECT
    d.day,
    COUNT(DISTINCT u.id_chambre) AS occupied_rooms
  FROM days d
  CROSS JOIN params p
  LEFT JOIN LATERAL (
    SELECT l.id_chambre
    FROM location l
    INNER JOIN chambre ch ON ch.id_chambre = l.id_chambre AND ch.id_hotel = p.id_hotel
    WHERE l.date_debut::date <= d.day AND l.date_fin::date > d.day
    UNION
    SELECT r.id_chambre
    FROM reservation r
    INNER JOIN chambre ch2 ON ch2.id_chambre = r.id_chambre AND ch2.id_hotel = p.id_hotel
    WHERE r.date_debut::date <= d.day AND r.date_fin::date > d.day
  ) u ON TRUE
  GROUP BY d.day
)
SELECT
  do.day,
  do.occupied_rooms,
  ri.total_rooms,
  ROUND(100.0 * do.occupied_rooms / NULLIF(ri.total_rooms, 0), 1) AS occupancy_pct,
  ROUND(
    AVG(100.0 * do.occupied_rooms / NULLIF(ri.total_rooms, 0))
      OVER (ORDER BY do.day ROWS BETWEEN 2 PRECEDING AND CURRENT ROW),
    1
  ) AS occupancy_3day_ma_pct
FROM daily_occupied do
CROSS JOIN room_inventory ri
ORDER BY do.day;


-- -----------------------------------------------------------------------------
-- Q3 — Business question:
-- Which room views (vue) generate the most revenue, and what share of total?
-- Techniques: CTE, SUM, RANK, percentage window
-- -----------------------------------------------------------------------------
WITH revenue_by_vue AS (
  SELECT
    ch.vue AS room_view,
    SUM(ch.prix * GREATEST(1, l.date_fin::date - l.date_debut::date)) AS revenue
  FROM location l
  INNER JOIN chambre ch ON ch.id_chambre = l.id_chambre
  GROUP BY ch.vue
)
SELECT
  room_view,
  ROUND(revenue::numeric, 2) AS revenue,
  ROUND(100.0 * revenue / SUM(revenue) OVER (), 1) AS pct_of_total_revenue,
  RANK() OVER (ORDER BY revenue DESC) AS revenue_rank
FROM revenue_by_vue
ORDER BY revenue_rank;


-- -----------------------------------------------------------------------------
-- Q4 — Business question:
-- Who are the most valuable clients (frequency and estimated spend)?
-- Techniques: UNION ALL, JOIN, aggregation, NTILE
-- -----------------------------------------------------------------------------
WITH client_stays AS (
  SELECT id_client, id_chambre, date_debut, date_fin
  FROM reservation
  UNION ALL
  SELECT id_client, id_chambre, date_debut, date_fin
  FROM location
),
client_metrics AS (
  SELECT
    cs.id_client,
    COUNT(*) AS stay_events,
    COUNT(DISTINCT cs.id_chambre) AS distinct_rooms,
    SUM(ch.prix * GREATEST(1, cs.date_fin::date - cs.date_debut::date)) AS estimated_spend
  FROM client_stays cs
  INNER JOIN chambre ch ON ch.id_chambre = cs.id_chambre
  GROUP BY cs.id_client
)
SELECT
  cl.id_client,
  cl.nom AS client_name,
  cl.email,
  cm.stay_events,
  cm.distinct_rooms,
  ROUND(cm.estimated_spend::numeric, 2) AS estimated_spend,
  NTILE(4) OVER (ORDER BY cm.estimated_spend DESC) AS spend_quartile
FROM client_metrics cm
INNER JOIN client cl ON cl.id_client = cm.id_client
ORDER BY estimated_spend DESC
LIMIT 15;


-- -----------------------------------------------------------------------------
-- Q5 — Business question:
-- Which rooms have never been reserved or checked in (dead inventory)?
-- Techniques: NOT EXISTS anti-join
-- -----------------------------------------------------------------------------
SELECT
  ch.id_chambre,
  h.nom AS hotel_name,
  ch.vue,
  ch.capacite,
  ch.prix,
  ch.etat
FROM chambre ch
INNER JOIN hotel h ON h.id_hotel = ch.id_hotel
WHERE NOT EXISTS (
        SELECT 1 FROM reservation r WHERE r.id_chambre = ch.id_chambre
      )
  AND NOT EXISTS (
        SELECT 1 FROM location l WHERE l.id_chambre = ch.id_chambre
      )
ORDER BY h.nom, ch.prix DESC;


-- -----------------------------------------------------------------------------
-- Q6 — Business question:
-- Does stay length vary by room capacity and hotel chain?
-- Techniques: JOIN chain, GROUP BY, AVG, PERCENTILE_CONT
-- -----------------------------------------------------------------------------
SELECT
  chn.nom AS chain_name,
  ch.capacite,
  COUNT(*) AS stay_count,
  ROUND(AVG(l.date_fin::date - l.date_debut::date)::numeric, 2) AS avg_nights,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY (l.date_fin::date - l.date_debut::date)
  ) AS median_nights
FROM location l
INNER JOIN chambre ch ON ch.id_chambre = l.id_chambre
INNER JOIN hotel h ON h.id_hotel = ch.id_hotel
INNER JOIN chainehoteliere chn ON chn.id_chaine = h.id_chaine
GROUP BY chn.nom, ch.capacite
HAVING COUNT(*) >= 3
ORDER BY chain_name, ch.capacite;


-- -----------------------------------------------------------------------------
-- Q7 — Business question:
-- How do monthly revenues grow hotel by hotel (month-over-month)?
-- Techniques: monthly buckets, LAG window, MoM %
-- -----------------------------------------------------------------------------
WITH monthly_revenue AS (
  SELECT
    h.id_hotel,
    h.nom AS hotel_name,
    date_trunc('month', l.date_debut)::date AS revenue_month,
    SUM(ch.prix * GREATEST(1, l.date_fin::date - l.date_debut::date)) AS revenue
  FROM location l
  INNER JOIN chambre ch ON ch.id_chambre = l.id_chambre
  INNER JOIN hotel h ON h.id_hotel = ch.id_hotel
  GROUP BY h.id_hotel, h.nom, date_trunc('month', l.date_debut)
)
SELECT
  id_hotel,
  hotel_name,
  revenue_month,
  ROUND(revenue::numeric, 2) AS revenue,
  ROUND(
    LAG(revenue) OVER (PARTITION BY id_hotel ORDER BY revenue_month)::numeric,
    2
  ) AS prev_month_revenue,
  ROUND(
    100.0 * (revenue - LAG(revenue) OVER (PARTITION BY id_hotel ORDER BY revenue_month))
    / NULLIF(LAG(revenue) OVER (PARTITION BY id_hotel ORDER BY revenue_month), 0),
    1
  ) AS mom_growth_pct
FROM monthly_revenue
ORDER BY id_hotel, revenue_month;


-- -----------------------------------------------------------------------------
-- Q8 — Business question:
-- Which employees handle the most stays, and what is reservation→stay conversion?
-- Techniques: aggregation, FILTER, RANK, funnel subquery
-- -----------------------------------------------------------------------------
WITH employee_checkins AS (
  SELECT
    e.id_employe,
    e.nom AS employee_name,
    h.id_hotel,
    h.nom AS hotel_name,
    COUNT(l.id_location) AS locations_handled,
    SUM(ch.prix * GREATEST(1, l.date_fin::date - l.date_debut::date)) AS revenue_attributed
  FROM employe e
  INNER JOIN hotel h ON h.id_hotel = e.id_hotel
  LEFT JOIN location l ON l.id_employe = e.id_employe
  LEFT JOIN chambre ch ON ch.id_chambre = l.id_chambre
  GROUP BY e.id_employe, e.nom, h.id_hotel, h.nom
),
reservation_funnel AS (
  SELECT
    ch.id_hotel,
    COUNT(*) AS total_reservations,
    COUNT(*) FILTER (
      WHERE EXISTS (
        SELECT 1 FROM location l2 WHERE l2.id_reservation = r.id_reservation
      )
    ) AS converted_to_location
  FROM reservation r
  INNER JOIN chambre ch ON ch.id_chambre = r.id_chambre
  GROUP BY ch.id_hotel
)
SELECT
  ec.employee_name,
  ec.hotel_name,
  ec.locations_handled,
  ROUND(ec.revenue_attributed::numeric, 2) AS revenue_attributed,
  RANK() OVER (PARTITION BY ec.hotel_name ORDER BY ec.locations_handled DESC) AS rank_in_hotel,
  rf.total_reservations,
  rf.converted_to_location,
  ROUND(
    100.0 * rf.converted_to_location / NULLIF(rf.total_reservations, 0),
    1
  ) AS reservation_conversion_pct
FROM employee_checkins ec
LEFT JOIN reservation_funnel rf ON rf.id_hotel = ec.id_hotel
WHERE ec.locations_handled > 0
ORDER BY ec.hotel_name, rank_in_hotel;
