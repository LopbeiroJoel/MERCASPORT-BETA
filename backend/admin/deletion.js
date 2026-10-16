// REPERE ORAL - SUPPRESSION DEFINITIVE (doc, section 13).
// Un DELETE enleve une ligne ; un UPDATE de statut la garderait. Ici je l'enleve vraiment.
// Je retire d'abord les lignes liees qui bloqueraient la cle etrangere, puis leur parent.
// La route appelle ces fonctions DANS une transaction : une erreur annule aussi les suppressions deja faites.
// Je ne deduis pas l'identite d'une candidature anonyme a partir de son email : je suis les vrais liens SQL.

const { fail } = require('./helpers');

// Effacer les dépendances avant leur parent, dans la transaction de la route.
// Annonce : verrou -> historique -> candidatures -> liens de postes -> annonce elle-meme.
async function deleteAd(client, adId) {
  const found = await client.query('SELECT id FROM public.ads WHERE id = $1 FOR UPDATE', [adId]);
  if (!found.rows.length) fail(404, 'AD_NOT_FOUND');
  await client.query('DELETE FROM public.admin_actions WHERE target_ad_id = $1', [adId]);
  await client.query('DELETE FROM public.applications WHERE ad_id = $1', [adId]);
  await client.query('DELETE FROM public.ad_positions WHERE ad_id = $1', [adId]);
  await client.query('DELETE FROM public.ads WHERE id = $1', [adId]);
}

// Compte : je refuse un compte admin protege, puis je nettoie ses relations avant users.
async function deleteUser(client, userId, adminId) {
  const result = await client.query(`SELECT u.id, u.role,
    EXISTS(SELECT 1 FROM public.admin_permissions p WHERE p.user_id = u.id) AS is_admin
    FROM public.users u WHERE u.id = $1 FOR UPDATE OF u`, [userId]);
  if (!result.rows.length) fail(404, 'USER_NOT_FOUND');
  if (result.rows[0].is_admin || result.rows[0].role.toUpperCase() === 'ADMIN' || userId === adminId) {
    fail(403, 'ADMIN_ACCOUNT_PROTECTED');
  }
  // Verrouiller le club avant ses annonces pour empêcher de nouvelles relations.
  await client.query('SELECT id FROM public.clubs WHERE user_id = $1 FOR UPDATE', [userId]);
  await client.query('SELECT id FROM public.players WHERE user_id = $1 FOR UPDATE', [userId]);
  const ads = await client.query(`SELECT a.id FROM public.ads a
    WHERE a.author_id = $1
       OR a.club_id IN (SELECT id FROM public.clubs WHERE user_id = $1)
       OR a.team_id IN (SELECT t.id FROM public.teams t JOIN public.clubs c ON c.id = t.club_id WHERE c.user_id = $1)
    ORDER BY a.id FOR UPDATE OF a`, [userId]);
  // Je passe aussi par deleteAd pour chaque annonce liee : meme ordre de nettoyage et meme transaction.
  for (const ad of ads.rows) await deleteAd(client, ad.id);
  await client.query(`DELETE FROM public.applications WHERE player_id IN
    (SELECT id FROM public.players WHERE user_id = $1)`, [userId]);
  await client.query('DELETE FROM public.players WHERE user_id = $1', [userId]);
  // Les equipes suivent la suppression du club avec ON DELETE CASCADE ; les annonces ont ete traitees avant.
  await client.query('DELETE FROM public.clubs WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM public.player_profiles WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM public.club_profiles WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM public.auth_sessions WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM public.admin_actions WHERE target_user_id = $1 OR admin_user_id = $1', [userId]);
  // Le parent part en dernier. Si une reference inattendue bloque, toute la transaction est annulee.
  await client.query('DELETE FROM public.users WHERE id = $1', [userId]);
}

module.exports = { deleteAd, deleteUser };
