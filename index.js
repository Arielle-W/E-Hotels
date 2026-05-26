const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: 'postgresql://postgres:1234@localhost:5432/eHotels'
});

// --- 1. AUTHENTIFICATION ---
app.post('/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    try {
      const clientRes = await pool.query(
        'SELECT ID_CLIENT, nom FROM Client WHERE email = $1 AND mot_de_passe = $2', [email, password]
      );
      if (clientRes.rows.length > 0) {
        return res.json({ id: clientRes.rows[0].id_client, role: 'client', nom: clientRes.rows[0].nom });
      }
  
      const employeRes = await pool.query(
        'SELECT ID_EMPLOYE, ID_HOTEL, nom, role FROM Employe WHERE email = $1 AND mot_de_passe = $2', 
        [email, password]
      );
      if (employeRes.rows.length > 0) {
        return res.json({ 
          id: employeRes.rows[0].id_employe, 
          id_hotel: employeRes.rows[0].id_hotel,
          role: employeRes.rows[0].role, 
          nom: employeRes.rows[0].nom 
        });
      }
  
      res.status(401).json({ message: "Email ou mot de passe incorrect" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/clients', async (req, res) => {
    const q = String(req.query.q || '').trim();
    const pattern = q ? '%' + q + '%' : null;
    try {
      const result = pattern
        ? await pool.query(
            `SELECT ID_CLIENT, nom, email FROM Client
             WHERE nom ILIKE $1 OR email ILIKE $1 OR CAST(ID_CLIENT AS TEXT) ILIKE $1
             ORDER BY nom ASC LIMIT 80`,
            [pattern]
          )
        : await pool.query(`SELECT ID_CLIENT, nom, email FROM Client ORDER BY nom ASC LIMIT 80`);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // --- 2. RECHERCHE DE CHAMBRES (FILTRE VUE AU LIEU DE ZONE) ---
  app.get('/chambres/disponibles', async (req, res) => {
    const { 
      date_debut, 
      date_fin, 
      capacite, 
      vue,           // Remplacé 'zone' par 'vue'
      prix_max, 
      categorie, 
      superficie_min, 
      nom_chaine 
    } = req.query;
  
    try {
      const query = `
        SELECT c.*, h.adresse, h.nom, h.categorie, ch.nom AS chaine_nom
      FROM Chambre c
      JOIN Hotel h ON c.ID_HOTEL = h.ID_HOTEL
      JOIN ChaineHoteliere ch ON h.ID_CHAINE = ch.ID_CHAINE
      WHERE c.capacite = $1 
      AND ($2::text IS NULL OR c.vue ILIKE $2)
      AND c.prix <= $3 
      AND h.categorie >= $4
      AND c.superficie >= $5
      AND ($6::text IS NULL OR ch.nom ILIKE $6)
      -- Disponibilité = absence de conflit de dates avec réservations ET locations
      AND c.ID_CHAMBRE NOT IN (
        SELECT ID_CHAMBRE FROM Reservation 
        WHERE NOT (date_fin <= $7 OR date_debut >= $8)
      )
      AND c.ID_CHAMBRE NOT IN (
        SELECT ID_CHAMBRE FROM Location
        WHERE NOT (date_fin <= $7 OR date_debut >= $8)
      )
      ORDER BY c.prix ASC`;
  
      const values = [
        capacite, 
        vue || null, 
        parseFloat(prix_max) || 99999, 
        parseInt(categorie) || 1, 
        parseInt(superficie_min) || 0, 
        nom_chaine || null, 
        date_debut, 
        date_fin
      ];
  
      const result = await pool.query(query, values);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Chambres libres pour un hôtel donné (réservations + locations qui chevauchent la période). */
  app.get('/chambres/disponibles-hotel/:id_hotel', async (req, res) => {
    const hid = parseInt(String(req.params.id_hotel), 10);
    const { date_debut, date_fin } = req.query;
    if (!Number.isFinite(hid) || !date_debut || !date_fin) {
      return res.status(400).json({ message: 'date_debut et date_fin requises (id hôtel valide).' });
    }
    try {
      const result = await pool.query(
        `SELECT c.*, h.adresse, h.nom AS hotel_nom, h.categorie, ch.nom AS chaine_nom
         FROM Chambre c
         JOIN Hotel h ON c.ID_HOTEL = h.ID_HOTEL
         JOIN ChaineHoteliere ch ON h.ID_CHAINE = ch.ID_CHAINE
         WHERE h.ID_HOTEL = $1
         AND c.ID_CHAMBRE NOT IN (
           SELECT ID_CHAMBRE FROM Reservation
           WHERE NOT (date_fin <= $2::date OR date_debut >= $3::date)
         )
         AND c.ID_CHAMBRE NOT IN (
           SELECT ID_CHAMBRE FROM Location
           WHERE NOT (date_fin <= $2::date OR date_debut >= $3::date)
         )
         ORDER BY c.prix ASC`,
        [hid, date_debut, date_fin]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // --- 3. GESTION DES CHAMBRES ---
  app.get('/chambres/:id_hotel', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM Chambre WHERE ID_HOTEL = $1', [req.params.id_hotel]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.post('/chambres', async (req, res) => {
    const { id_hotel, prix, vue, capacite, commodites, ajouter_lit, superficie } = req.body ?? {};
    try {
      const result = await pool.query(
        'INSERT INTO Chambre (ID_HOTEL, prix, vue, capacite, commodites, ajouter_lit, etat, superficie) VALUES ($1, $2, $3, $4, $5, $6, \'disponible\', $7) RETURNING *',
        [id_hotel, prix, vue, capacite, commodites, ajouter_lit, superficie]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.put('/chambres/:id', async (req, res) => {
    const { prix, vue, capacite, commodites, ajouter_lit, etat, superficie } = req.body ?? {};
    try {
      const result = await pool.query(
        'UPDATE Chambre SET prix=$1, vue=$2, capacite=$3, commodites=$4, ajouter_lit=$5, etat=$6, superficie=$7 WHERE ID_CHAMBRE=$8 RETURNING *',
        [prix, vue, capacite, commodites, ajouter_lit, etat, superficie, req.params.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.delete('/chambres/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM Chambre WHERE ID_CHAMBRE = $1', [req.params.id]);
      res.json({ message: "Chambre supprimée" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // --- 4. RÉSERVATIONS ET LOCATIONS ---
  app.post('/reservations', async (req, res) => {
    const { id_client, id_chambre, date_debut, date_fin } = req.body ?? {};
    const cid = parseInt(String(id_client), 10);
    const chid = parseInt(String(id_chambre), 10);
    if (!Number.isFinite(cid) || !Number.isFinite(chid) || !date_debut || !date_fin) {
      return res.status(400).json({ message: 'id_client, id_chambre, date_debut et date_fin sont requis et doivent être valides.' });
    }
    try {
      const result = await pool.query(
        'INSERT INTO Reservation (ID_CLIENT, ID_CHAMBRE, date_debut, date_fin, date_reservation) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING *',
        [cid, chid, date_debut, date_fin]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.get('/reservations/attente/:id_hotel', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT r.*,
                cl.nom AS client_nom,
                ch.ID_CHAMBRE,
                ch.prix AS prix_chambre,
                ch.vue AS vue_chambre,
                ch.capacite AS capacite_chambre
         FROM Reservation r
         JOIN Client cl ON r.ID_CLIENT = cl.ID_CLIENT
         JOIN Chambre ch ON r.ID_CHAMBRE = ch.ID_CHAMBRE
         WHERE ch.ID_HOTEL = $1
         AND r.ID_RESERVATION NOT IN (SELECT ID_RESERVATION FROM Location WHERE ID_RESERVATION IS NOT NULL)`,
        [req.params.id_hotel]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/reservations/:id_client', async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT r.*,
                h.ID_HOTEL,
                CONCAT_WS(' — ', h.nom, h.adresse) AS nom_hotel,
                ch.ID_CHAMBRE,
                ch.prix AS prix_chambre,
                ch.capacite AS capacite_chambre,
                ch.vue AS vue_chambre,
                CASE
                  WHEN EXISTS (
                    SELECT 1 FROM Location l
                    WHERE l.ID_RESERVATION = r.ID_RESERVATION
                  )
                  THEN 'Location en cours'
                  ELSE 'En attente de check-in'
                END AS statut
         FROM Reservation r
         JOIN Chambre ch ON r.ID_CHAMBRE = ch.ID_CHAMBRE
         JOIN Hotel h ON ch.ID_HOTEL = h.ID_HOTEL
         WHERE r.ID_CLIENT = $1
         ORDER BY r.date_reservation DESC NULLS LAST, r.ID_RESERVATION DESC`,
        [req.params.id_client]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/reservations/:id', async (req, res) => {
    const rid = parseInt(String(req.params.id), 10);
    const cid = parseInt(String(req.body?.id_client ?? req.body?.ID_CLIENT), 10);
    if (!Number.isFinite(rid) || !Number.isFinite(cid)) {
      return res.status(400).json({ message: 'id réservation et id_client requis (entiers).' });
    }
    try {
      const result = await pool.query(
        `DELETE FROM Reservation r
         WHERE r.ID_RESERVATION = $1 AND r.ID_CLIENT = $2
         AND NOT EXISTS (SELECT 1 FROM Location l WHERE l.ID_RESERVATION = r.ID_RESERVATION)
         RETURNING *`,
        [rid, cid]
      );
      if (result.rowCount === 0) {
        return res.status(404).json({
          message: 'Réservation introuvable, déjà convertie en location, ou non autorisée.',
        });
      }
      res.json({ message: 'Réservation supprimée', ...result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.put('/reservations/:id/checkin', async (req, res) => {
    const rawEmp = req.body?.id_employe ?? req.body?.ID_EMPLOYE;
    const idEmploye = parseInt(String(rawEmp), 10);
    if (!Number.isFinite(idEmploye)) {
      return res.status(400).json({ message: 'id_employe requis (entier valide).' });
    }
    try {
      const resv = await pool.query('SELECT * FROM Reservation WHERE ID_RESERVATION = $1', [req.params.id]);
      if (resv.rows.length === 0) {
        return res.status(404).json({ message: 'Réservation introuvable.' });
      }
      const { id_client, id_chambre, date_debut, date_fin } = resv.rows[0];
      const location = await pool.query(
        'INSERT INTO Location (ID_CLIENT, ID_CHAMBRE, ID_EMPLOYE, ID_RESERVATION, date_debut, date_fin, date_checkin) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING *',
        [id_client, id_chambre, idEmploye, req.params.id, date_debut, date_fin]
      );
      res.json(location.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // Location directe (sans réservation préalable)
  app.post('/locations', async (req, res) => {
    const { id_client, id_chambre, id_employe, date_debut, date_fin } = req.body ?? {};
    try {
      const result = await pool.query(
        'INSERT INTO Location (ID_CLIENT, ID_CHAMBRE, ID_EMPLOYE, ID_RESERVATION, date_debut, date_fin, date_checkin) VALUES ($1, $2, $3, NULL, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
        [id_client, id_chambre, id_employe, date_debut, date_fin]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // --- 5. GESTION DES EMPLOYÉS ---
  app.get('/employes/:id_hotel', async (req, res) => {
    try {
      const result = await pool.query('SELECT * FROM Employe WHERE ID_HOTEL = $1', [req.params.id_hotel]);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.post('/employes', async (req, res) => {
    const { id_hotel, nom, adresse, nas, role, email, mot_de_passe } = req.body ?? {};
    try {
      const result = await pool.query(
        'INSERT INTO Employe (ID_HOTEL, nom, adresse, NAS, role, email, mot_de_passe) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [id_hotel, nom, adresse, nas, role, email, mot_de_passe]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.put('/employes/:id', async (req, res) => {
    const { nom, adresse, nas, role, email, mot_de_passe } = req.body ?? {};
    try {
      const result = await pool.query(
        'UPDATE Employe SET nom=$1, adresse=$2, NAS=$3, role=$4, email=$5, mot_de_passe=$6 WHERE ID_EMPLOYE=$7 RETURNING *',
        [nom, adresse, nas, role, email, mot_de_passe, req.params.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  app.delete('/employes/:id', async (req, res) => {
    try {
      await pool.query('DELETE FROM Employe WHERE ID_EMPLOYE = $1', [req.params.id]);
      res.json({ message: "Employé supprimé" });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** Agrégats tableau de bord gestionnaire (données réelles pour un hôtel). */
  app.get('/manager/hotel/:id_hotel/dashboard', async (req, res) => {
    const hid = parseInt(String(req.params.id_hotel), 10);
    if (!Number.isFinite(hid)) {
      return res.status(400).json({ message: 'Identifiant hôtel invalide.' });
    }
    try {
      const hotelRes = await pool.query(
        'SELECT ID_HOTEL, nom, adresse FROM Hotel WHERE ID_HOTEL = $1',
        [hid]
      );
      if (hotelRes.rows.length === 0) {
        return res.status(404).json({ message: 'Hôtel introuvable.' });
      }
      const hotel = hotelRes.rows[0];

      const [emp, chTot, chPretes, maint] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS n FROM Employe WHERE ID_HOTEL = $1', [hid]),
        pool.query('SELECT COUNT(*)::int AS n FROM Chambre WHERE ID_HOTEL = $1', [hid]),
        pool.query(
          `SELECT COUNT(*)::int AS n FROM Chambre
           WHERE ID_HOTEL = $1 AND (etat IS NULL OR LOWER(TRIM(etat)) = 'disponible')`,
          [hid]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS n FROM Chambre
           WHERE ID_HOTEL = $1 AND etat IS NOT NULL AND LOWER(TRIM(etat)) <> 'disponible'`,
          [hid]
        ),
      ]);

      const totalCh = chTot.rows[0].n || 0;
      const occToday = await pool.query(
        `SELECT COUNT(DISTINCT u.id_chambre)::int AS n
         FROM (
           SELECT l.ID_CHAMBRE AS id_chambre
           FROM Location l
           INNER JOIN Chambre ch ON ch.ID_CHAMBRE = l.ID_CHAMBRE AND ch.ID_HOTEL = $1
           WHERE l.date_debut::date <= CURRENT_DATE AND l.date_fin::date > CURRENT_DATE
           UNION
           SELECT r.ID_CHAMBRE
           FROM Reservation r
           INNER JOIN Chambre ch2 ON ch2.ID_CHAMBRE = r.ID_CHAMBRE AND ch2.ID_HOTEL = $1
           WHERE r.date_debut::date <= CURRENT_DATE AND r.date_fin::date > CURRENT_DATE
         ) u`,
        [hid]
      );
      const occN = occToday.rows[0].n || 0;
      const occupancyPct = totalCh > 0 ? Math.round((100 * occN) / totalCh) : 0;

      const occSeries = await pool.query(
        `WITH days AS (
           SELECT generate_series(CURRENT_DATE - 6, CURRENT_DATE, INTERVAL '1 day')::date AS d
         ),
         tot AS (SELECT COUNT(*)::numeric AS n FROM Chambre WHERE ID_HOTEL = $1)
         SELECT days.d AS day,
                CASE
                  WHEN tot.n <= 0 THEN 0::numeric
                  ELSE ROUND(
                    100 * (
                      SELECT COUNT(DISTINCT u.id_chambre)::numeric
                      FROM (
                        SELECT l.ID_CHAMBRE AS id_chambre
                        FROM Location l
                        INNER JOIN Chambre ch ON ch.ID_CHAMBRE = l.ID_CHAMBRE AND ch.ID_HOTEL = $1
                        WHERE l.date_debut::date <= days.d AND l.date_fin::date > days.d
                        UNION
                        SELECT r.ID_CHAMBRE
                        FROM Reservation r
                        INNER JOIN Chambre ch2 ON ch2.ID_CHAMBRE = r.ID_CHAMBRE AND ch2.ID_HOTEL = $1
                        WHERE r.date_debut::date <= days.d AND r.date_fin::date > days.d
                      ) u
                    ) / tot.n,
                    1
                  )
                END AS pct
         FROM days CROSS JOIN tot
         ORDER BY days.d`,
        [hid]
      );

      const revCur = await pool.query(
        `SELECT COALESCE(SUM(
           ch.prix * GREATEST(1, (l.date_fin::date - l.date_debut::date))
         ), 0)::numeric AS s
         FROM Location l
         INNER JOIN Chambre ch ON ch.ID_CHAMBRE = l.ID_CHAMBRE AND ch.ID_HOTEL = $1
         WHERE l.date_debut >= date_trunc('month', CURRENT_DATE)
           AND l.date_debut < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'`,
        [hid]
      );
      const revPrev = await pool.query(
        `SELECT COALESCE(SUM(
           ch.prix * GREATEST(1, (l.date_fin::date - l.date_debut::date))
         ), 0)::numeric AS s
         FROM Location l
         INNER JOIN Chambre ch ON ch.ID_CHAMBRE = l.ID_CHAMBRE AND ch.ID_HOTEL = $1
         WHERE l.date_debut >= date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'
           AND l.date_debut < date_trunc('month', CURRENT_DATE)`,
        [hid]
      );

      const revToday = await pool.query(
        `SELECT COALESCE(SUM(
           ch.prix * GREATEST(1, (l.date_fin::date - l.date_debut::date))
         ), 0)::numeric AS s
         FROM Location l
         INNER JOIN Chambre ch ON ch.ID_CHAMBRE = l.ID_CHAMBRE AND ch.ID_HOTEL = $1
         WHERE COALESCE(l.date_checkin::date, l.date_debut::date) = CURRENT_DATE`,
        [hid]
      );

      const recentRes = await pool.query(
        `SELECT r.ID_RESERVATION, r.date_debut, r.date_fin, r.date_reservation,
                cl.nom AS client_nom,
                ch.ID_CHAMBRE, ch.prix, ch.vue,
                (ch.prix * GREATEST(1, (r.date_fin::date - r.date_debut::date)))::int AS tarif_estime,
                CASE
                  WHEN NOT EXISTS (SELECT 1 FROM Location l WHERE l.ID_RESERVATION = r.ID_RESERVATION)
                    THEN 'EN ATTENTE'
                  WHEN (SELECT MAX(l2.date_fin::date) FROM Location l2 WHERE l2.ID_RESERVATION = r.ID_RESERVATION) < CURRENT_DATE
                    THEN 'TERMINÉ'
                  ELSE 'CONFIRMÉ'
                END AS statut_label
         FROM Reservation r
         INNER JOIN Client cl ON cl.ID_CLIENT = r.ID_CLIENT
         INNER JOIN Chambre ch ON ch.ID_CHAMBRE = r.ID_CHAMBRE AND ch.ID_HOTEL = $1
         ORDER BY r.date_reservation DESC NULLS LAST, r.ID_RESERVATION DESC
         LIMIT 8`,
        [hid]
      );

      const cur = parseFloat(revCur.rows[0].s) || 0;
      const prev = parseFloat(revPrev.rows[0].s) || 0;
      let revenueGrowthPct = null;
      if (prev > 0) revenueGrowthPct = Math.round(((cur - prev) / prev) * 1000) / 10;
      else if (cur > 0) revenueGrowthPct = 100;

      res.json({
        hotel: {
          id: hotel.id_hotel,
          nom: hotel.nom,
          adresse: hotel.adresse,
        },
        employes_count: emp.rows[0].n || 0,
        chambres_count: totalCh,
        chambres_pretes: chPretes.rows[0].n || 0,
        maintenance_count: maint.rows[0].n || 0,
        occupancy_today_pct: occupancyPct,
        chambres_occupees_aujourdhui: occN,
        revenue_month: Math.round(cur),
        revenue_prev_month: Math.round(prev),
        revenue_growth_pct: revenueGrowthPct,
        revenue_today: Math.round(parseFloat(revToday.rows[0].s) || 0),
        occupancy_week: occSeries.rows.map((row) => ({
          day: row.day,
          pct: parseFloat(row.pct) || 0,
        })),
        recent_reservations: recentRes.rows.map((r) => ({
          id_reservation: r.id_reservation,
          client_nom: r.client_nom,
          id_chambre: r.id_chambre,
          vue: r.vue,
          tarif_estime: r.tarif_estime,
          statut: r.statut_label || 'EN ATTENTE',
          date_reservation: r.date_reservation,
        })),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  const PORT = 3000;
  app.listen(PORT, () => console.log(`Serveur e-Hôtels prêt sur le port ${PORT}`));