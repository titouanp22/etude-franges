// Réglages de déploiement (à modifier selon l'hébergement)
window.STUDY_CONFIG = {
  // Où envoyer les réponses (à la fin de chaque partie). Vide = bouton de téléchargement du CSV
  // à la fin (pratique pour un pilote ou une étude en laboratoire sur un seul poste).
  SAVE_URL: "https://script.google.com/macros/s/AKfycbzu0KkFjqg2UMRZRgzwjCQfHmdcvZDMSmjgUpd2WboiKRuDyKJ1YBet83LiQmIRlRTs/exec",

  // "apps_script" pour une Web App Google Apps Script (voir tools/google_apps_script.gs),
  // "json" pour un serveur qui accepte un POST JSON et répond 200.
  SAVE_MODE: "apps_script",

  // URL de fin (ex. lien de complétion Prolific). Vide = écran de remerciement.
  COMPLETION_URL: "",

  // Contact affiché sur la page d'accueil (ex. adresse e-mail du responsable de l'étude).
  CONTACT: "",

  // true = version de démonstration : rien n'est enregistré ni téléchargé.
  DEMO: false,
};
